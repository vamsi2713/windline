from datetime import datetime, timezone
import os
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from .analytics import analyze
from datetime import datetime, timezone, timedelta

BASE = os.getenv("ELEXON_API_BASE", "https://data.elexon.co.uk/bmrs/api/v1")
app = FastAPI(title="Windline API", version="1.0.0", description="Auditable UK wind forecast accuracy analysis")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET"], allow_headers=["*"])

async def fetch_dataset(dataset: str, start: str, end: str) -> list[dict]:
    url = f"{BASE}/datasets/{dataset}/stream"
    try:
        async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
            response = await client.get(url, params={"from": start, "to": end}, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
        if isinstance(payload, dict):
            payload = payload.get("data", payload.get("results", []))
        if not isinstance(payload, list):
            raise ValueError("Unexpected dataset response shape")
        return [r for r in payload if isinstance(r, dict)]
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"Elexon {dataset} retrieval failed: {exc}. No fixture data is substituted.") from exc

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "windline-api", "utcTime": datetime.now(timezone.utc).isoformat()}



@app.get("/api/analysis")
async def get_analysis(cutoff_hour_utc: int = Query(default=9, ge=0, le=23)):
    import asyncio

    start_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end_date = datetime(2026, 2, 1, tzinfo=timezone.utc)

    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
        # Retrieve actual wind generation for January 2026.
        actual_response = await client.get(
            f"{BASE}/datasets/FUELHH/stream",
            params={
                "settlementDateFrom": "2026-01-01",
                "settlementDateTo": "2026-01-31",
                "fuelType": "WIND",
            },
            headers={"Accept": "application/json"},
        )
        actual_response.raise_for_status()
        actual = actual_response.json()

        if not isinstance(actual, list):
            raise HTTPException(
                status_code=502,
                detail="Unexpected FUELHH response format from Elexon",
            )

        # Request the wind forecast snapshot available by each day's cutoff.
        async def fetch_forecast_snapshot(delivery_day):
            cutoff = (
                delivery_day
                - timedelta(days=1)
            ).replace(hour=cutoff_hour_utc)

            response = await client.get(
                f"{BASE}/forecast/generation/wind/history",
                params={"publishTime": cutoff.isoformat().replace("+00:00", "Z")},
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()

            if isinstance(payload, dict):
                payload = payload.get("data", payload.get("results", []))

            if not isinstance(payload, list):
                raise ValueError(
                    f"Unexpected WINDFOR history response for {cutoff.date()}"
                )

            return [r for r in payload if isinstance(r, dict)]

        delivery_days = []
        day = start_date
        while day < end_date:
            delivery_days.append(day)
            day += timedelta(days=1)

        try:
            snapshots = await asyncio.gather(
                *(fetch_forecast_snapshot(day) for day in delivery_days)
            )
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Elexon WINDFOR history retrieval failed: {exc}",
            ) from exc

    actual = [
        r for r in actual
        if isinstance(r, dict)
        and str(r.get("fuelType", "")).strip().upper() == "WIND"
    ]

    # Preserve the publication timestamp on each record so analyze()
    # can apply its cutoff and choose the appropriate forecast per hour.
    forecast_by_key = {}
    for snapshot in snapshots:
        for record in snapshot:
            key = (
                record.get("publishTime"),
                record.get("startTime"),
                record.get("generation"),
            )
            forecast_by_key[key] = record

    forecast = list(forecast_by_key.values())

    result = analyze(actual, forecast, cutoff_hour_utc)

    result["provenance"] = {
        "source": "Elexon Insights API",
        "actualDataset": "FUELHH",
        "forecastEndpoint": "/forecast/generation/wind/history",
        "forecastDataset": "WINDFOR",
        "retrievedAtUtc": datetime.now(timezone.utc).isoformat(),
        "actualRecordsReceived": len(actual),
        "forecastRecordsReceived": len(forecast),
        "forecastSnapshotsRequested": len(delivery_days),
        "cutoffHourUtc": cutoff_hour_utc,
        "status": "success",
    }

    return result



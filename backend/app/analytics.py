
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import sqrt
from typing import Any


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        n = float(value)
        return n if n == n and abs(n) != float("inf") else None
    except (ValueError, TypeError):
        return None


def analyze(
    actual_records: list[dict],
    forecast_records: list[dict],
    cutoff_hour_utc: int = 9,
) -> dict:
    """Compare January 2026 hourly wind forecasts with hourly mean actuals.

    For each delivery hour, select the latest forecast published no later
    than cutoff_hour_utc on the preceding UTC calendar day.

    This cutoff is an analytical assumption, not a claim about an official
    procurement or trading process.
    """
    if not 0 <= cutoff_hour_utc <= 23:
        raise ValueError("cutoff_hour_utc must be between 0 and 23")

    # 1. Collect January wind actuals at their original timestamps.
    actual_values: dict[datetime, set[float]] = {}
    rejected_actual = 0

    for record in actual_records:
        if str(record.get("fuelType", "")).strip().upper() != "WIND":
            continue

        target = parse_time(record.get("startTime"))
        generation = _number(record.get("generation"))

        if target is None or generation is None:
            rejected_actual += 1
            continue

        if target.year == 2026 and target.month == 1:
            actual_values.setdefault(target, set()).add(generation)

    # Collapse identical duplicates and reject conflicting duplicates once.
    actual_half_hourly: dict[datetime, float] = {}
    for target, values in actual_values.items():
        if len(values) == 1:
            actual_half_hourly[target] = next(iter(values))
        else:
            rejected_actual += 1

    # 2. Aggregate two half-hour actual values into each hourly mean.
    hourly_values: dict[datetime, list[float]] = {}

    for target, generation in actual_half_hourly.items():
        hour = target.replace(minute=0, second=0, microsecond=0)
        hourly_values.setdefault(hour, []).append(generation)

    actual_by_period = {
    hour: sum(values) / 2
    for hour, values in hourly_values.items()
    if len(values) == 2
}

    # 3. Keep only forecasts published by the preceding-day cutoff.
    forecasts: dict[datetime, list[tuple[datetime, float]]] = {}
    rejected_forecast = 0
    eligible_records = 0

    for record in forecast_records:
        target = parse_time(record.get("startTime"))
        published = parse_time(record.get("publishTime"))
        generation = _number(record.get("generation"))

        if target is None or published is None or generation is None:
            rejected_forecast += 1
            continue

        if target.year != 2026 or target.month != 1:
            continue

        # Forecast data should align to the top of an hour.
        if target.minute != 0 or target.second != 0 or target.microsecond != 0:
            rejected_forecast += 1
            continue

        cutoff = (
            datetime(target.year, target.month, target.day, tzinfo=timezone.utc)
            - timedelta(days=1)
        ).replace(hour=cutoff_hour_utc)

        if published <= cutoff:
            eligible_records += 1
            forecasts.setdefault(target, []).append((published, generation))

    # 4. Select the latest eligible publication for each delivery hour.
    rows = []
    ambiguous = 0

    all_periods = sorted(set(actual_by_period) | set(forecasts))

    for target in all_periods:
        candidates = forecasts.get(target, [])
        selected = None

        if candidates:
            latest_time = max(published for published, _ in candidates)
            latest_candidates = [
                (published, value)
                for published, value in candidates
                if published == latest_time
            ]
            distinct_values = {value for _, value in latest_candidates}

            if len(distinct_values) > 1:
                ambiguous += 1
            else:
                selected = (latest_time, latest_candidates[0][1])

        actual = actual_by_period.get(target)
        forecast = selected[1] if selected is not None else None

        error = (
            forecast - actual
            if forecast is not None and actual is not None
            else None
        )

        if error is not None:
            status = "matched"
        elif candidates and selected is None:
            status = "ambiguous forecast tie"
        elif actual is None:
            status = "missing actual"
        else:
            status = "missing forecast"

        rows.append({
            "startTime": target.isoformat().replace("+00:00", "Z"),
            "publishTime": (
                selected[0].isoformat().replace("+00:00", "Z")
                if selected is not None
                else None
            ),
            "forecast": forecast,
            "actual": actual,
            "error": error,
            "absoluteError": abs(error) if error is not None else None,
            "status": status,
        })

    # 5. Calculate metrics only from matched forecast/actual pairs.
    errors = [row["error"] for row in rows if row["error"] is not None]
    matched = len(errors)
    expected_periods = 31 * 24

    metrics = {
        "matchedPeriods": matched,
        "expectedPeriods": expected_periods,
        "coveragePercent": round(100 * matched / expected_periods, 2),
        "mae": round(sum(abs(e) for e in errors) / matched, 3)
        if matched else None,
        "mbe": round(sum(errors) / matched, 3)
        if matched else None,
        "rmse": round(sqrt(sum(e * e for e in errors) / matched), 3)
        if matched else None,
    }

    return {
        "rows": rows,
        "metrics": metrics,
        "quality": {
            "eligibleForecastRecords": eligible_records,
            "eligibleForecastPeriods": len(forecasts),
            "rejectedActualRecords": rejected_actual,
            "rejectedForecastRecords": rejected_forecast,
            "ambiguousPeriods": ambiguous,
            "actualPeriods": len(actual_by_period),
            "forecastPeriods": len(forecasts),
        },
        "methodology": {
            "cutoffHourUtc": cutoff_hour_utc,
            "cutoffRule": (
                f"Latest forecast published at or before "
                f"{cutoff_hour_utc:02d}:00 UTC on the UTC calendar day "
                "before delivery."
            ),
            "periodInterpretation": (
                "January 2026 delivery periods, grouped by UTC hour."
            ),
            "actualAggregation": (
                "Hourly mean of exactly two distinct half-hour actual values."
            ),
            "errorConvention": (
                "forecast - actual; positive means overprediction."
            ),
        },
    }

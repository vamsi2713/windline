
from app.analytics import analyze, parse_time


def make_actual(hour, value=100, minute=0, fuel="WIND"):
    return {
        "fuelType": fuel,
        "startTime": f"2026-01-02T{hour:02d}:{minute:02d}:00Z",
        "generation": value,
    }


def make_forecast(hour, value, published, minute=0):
    return {
        "startTime": f"2026-01-02T{hour:02d}:{minute:02d}:00Z",
        "publishTime": published,
        "generation": value,
    }


def test_latest_eligible_not_latest_overall():
    actual = [
        make_actual(10, 90, 0),
        make_actual(10, 110, 30),
    ]
    forecasts = [
        make_forecast(10, 90, "2026-01-01T08:00:00Z"),
        make_forecast(10, 110, "2026-01-01T08:59:00Z"),
        make_forecast(10, 500, "2026-01-01T10:00:00Z"),
    ]

    out = analyze(actual, forecasts)
    row = next(r for r in out["rows"] if r["startTime"] == "2026-01-02T10:00:00Z")

    assert row["forecast"] == 110
    assert row["publishTime"] == "2026-01-01T08:59:00Z"
    assert row["actual"] == 100
    assert row["error"] == 10


def test_metrics_hand_checkable():
    actual = [
        make_actual(10, 90, 0),
        make_actual(10, 110, 30),
        make_actual(11, 90, 0),
        make_actual(11, 110, 30),
    ]
    forecasts = [
        make_forecast(10, 110, "2026-01-01T08:00:00Z"),
        make_forecast(11, 90, "2026-01-01T08:00:00Z"),
    ]

    metrics = analyze(actual, forecasts)["metrics"]

    assert metrics["matchedPeriods"] == 2
    assert metrics["mae"] == 10
    assert metrics["mbe"] == 0
    assert metrics["rmse"] == 10


def test_timezone_normalization():
    assert (
        parse_time("2026-01-01T01:00:00+01:00")
        == parse_time("2026-01-01T00:00:00Z")
    )


def test_future_forecast_excluded_and_missing_data_explicit():
    actual = [
        make_actual(10, 90, 0),
        make_actual(10, 110, 30),
    ]
    future_forecast = make_forecast(
        10, 500, "2026-01-01T10:00:00Z"
    )

    out = analyze(actual, [future_forecast])
    row = next(r for r in out["rows"] if r["startTime"] == "2026-01-02T10:00:00Z")

    assert out["metrics"]["matchedPeriods"] == 0
    assert row["status"] == "missing forecast"
    assert row["forecast"] is None
    assert row["actual"] == 100
    assert out["metrics"]["mae"] is None


def test_non_wind_ignored():
    actual = [
        make_actual(10, 90, 0, fuel="GAS"),
        make_actual(10, 110, 30, fuel="GAS"),
    ]
    forecast = make_forecast(10, 110, "2026-01-01T08:00:00Z")

    out = analyze(actual, [forecast])

    assert out["metrics"]["matchedPeriods"] == 0


def test_conflicting_latest_tie_is_ambiguous():
    actual = [
        make_actual(10, 90, 0),
        make_actual(10, 110, 30),
    ]
    published = "2026-01-01T08:59:00Z"
    forecasts = [
        make_forecast(10, 110, published),
        make_forecast(10, 120, published),
    ]

    out = analyze(actual, forecasts)
    row = next(r for r in out["rows"] if r["startTime"] == "2026-01-02T10:00:00Z")

    assert out["quality"]["ambiguousPeriods"] == 1
    assert row["status"] == "ambiguous forecast tie"
    assert row["error"] is None

# Windline — Wind Generation Forecast Accuracy

## Analysis methodology

### Data sources

- **Actual generation:** Elexon Insights API (`FUELHH`), filtered to wind generation for January 2026.
- **Forecast generation:** Elexon Insights API wind forecast history endpoint.
- **Analysis period:** 1–31 January 2026, evaluated at hourly resolution.

### Forecast selection

The analysis uses a configured cutoff of 09:00 UTC on the day before delivery. For each delivery hour, the selected forecast must have been published at or before the applicable cutoff. The publication timestamp is retained to support auditability.

This cutoff is an analytical assumption, not a claim about an official procurement or trading rule.

### Data processing

Actual half-hourly wind-generation records are aggregated to hourly values when the expected half-hourly observations are available. Forecast and actual values are matched by delivery-hour timestamp. Missing or conflicting records are reported rather than silently replaced.

### Evaluation metrics

- **MAE (Mean Absolute Error):** Average absolute forecast error, in MW.
- **MBE (Mean Bias Error):** Average forecast minus actual generation, in MW. A positive value indicates overforecasting.
- **RMSE (Root Mean Squared Error):** Square root of the mean squared forecast error, in MW.
- **Coverage:** Matched forecast-and-actual hours divided by the 744 expected hours in January 2026.

### Limitations

This analysis evaluates wind-generation forecast accuracy; it does not calculate the quantity of electricity that should be procured. A procurement recommendation would also require demand forecasts, contracted supply, and relevant market or balancing rules.

The forecast cutoff is an analytical assumption and should be interpreted in the context of the intended procurement decision.

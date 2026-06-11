# Spurs-Knicks Event Study

Source: ESPN public event summary API for event `401859966`.

## Break

The Spurs' maximum lead was 29. It was first reached at 2Q 3:06 and last reached at 3Q 9:40.
The event-study break uses the last maximum-lead timestamp: De'Aaron Fox makes 16-foot pullup jump shot (Devin Vassell assists) (Spurs 81, Knicks 52).

## Raw Split

| Split | Minutes | Spurs points | Knicks points | Margin |
|---|---:|---:|---:|---:|
| Pre-break, including last max-lead play | 26.33 | 81 | 52 | +29 |
| Post-break | 21.67 | 25 | 55 | -30 |

## Regressions

Model: 30-second event-time bins, weighted by bin duration. `points_per_minute = alpha + tau * post_break + error`.

| Team | Pre-break ppm | Post-break ppm | Post change ppm | 95% CI for change | p-value |
|---|---:|---:|---:|---:|---:|
| Spurs | 3.076 | 1.154 | -1.922 | [-2.977, -0.868] | 0.000 |
| Knicks | 1.975 | 2.538 | +0.564 | [-0.489, +1.617] | 0.290 |

## Attribution

Observed gap closure: 30 points, from Spurs +29 to -1.

### Own pre-rate counterfactual

Using each team's own pre-break rate, the Spurs' post-break coefficient implies 41.6 lost points, while the Knicks' coefficient implies 12.2 added points.
Those two coefficients sum to 53.9 points of deviation from pre-break trends, not 30, because the Spurs' pre-break pace would have widened the lead by another 23.9 points.
On this trend-deviation basis: Spurs falloff 77%, Knicks surge 23%.

### Knicks common benchmarks

| Benchmark | Spurs falloff | Knicks surge | Spurs share | Knicks share |
|---|---:|---:|---:|---:|
| Knicks pre-break rate (1.975 ppm) | 17.8 | 12.2 | 59% | 41% |
| Knicks post-break rate (2.538 ppm) | 30.0 | 0.0 | 100% | 0% |

## Interpretation

Relative to their own pre-break pace, the Spurs lost about 41.6 expected points after the break, while the Knicks added about 12.2 expected points.
By scoring-rate change, the Spurs' collapse was about 3.4x as large as the Knicks' surge. The Spurs-side shortfall accounts for roughly 77% of the combined post-break deviation from pre-break pace.

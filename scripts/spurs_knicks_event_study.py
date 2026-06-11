#!/usr/bin/env python3
"""Event study around the maximum Spurs lead in Knicks-Spurs Game 4."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import statsmodels.api as sm


ROOT = Path(__file__).resolve().parents[1]
RAW_PATH = ROOT / "data/spurs_knicks_event_study/espn_summary_401859966.json"
DATA_DIR = ROOT / "data/spurs_knicks_event_study"
OUTPUT_DIR = ROOT / "outputs/spurs_knicks_event_study"
BIN_WIDTH_MINUTES = 0.5
GAME_LENGTH_MINUTES = 48.0
SPURS_ID = "24"
KNICKS_ID = "18"

os.environ.setdefault("MPLCONFIGDIR", str(OUTPUT_DIR / ".matplotlib"))

import matplotlib.pyplot as plt


def parse_clock_minutes_remaining(display_value: str) -> float:
    value = display_value.strip()
    if ":" in value:
        minutes, seconds = value.split(":", 1)
        return int(minutes) + float(seconds) / 60.0
    return float(value) / 60.0


def elapsed_minutes(play: dict) -> float:
    period = int(play["period"]["number"])
    remaining = parse_clock_minutes_remaining(play["clock"]["displayValue"])
    return (period - 1) * 12.0 + (12.0 - remaining)


def game_time_label(elapsed: float) -> str:
    period = int(elapsed // 12) + 1
    period = min(period, 4)
    elapsed_in_period = elapsed - (period - 1) * 12.0
    remaining = max(0.0, 12.0 - elapsed_in_period)
    minutes = int(remaining)
    seconds = round((remaining - minutes) * 60.0, 1)
    if seconds >= 60:
        minutes += 1
        seconds -= 60
    if abs(seconds - round(seconds)) < 1e-9:
        seconds_text = f"{int(round(seconds)):02d}"
    else:
        seconds_text = f"{seconds:04.1f}"
    suffix = {1: "1Q", 2: "2Q", 3: "3Q", 4: "4Q"}[period]
    return f"{suffix} {minutes}:{seconds_text}"


def scoring_timeline(summary: dict) -> pd.DataFrame:
    rows = []
    for play in summary["plays"]:
        if not play.get("scoringPlay"):
            continue
        team_id = str(play.get("team", {}).get("id", ""))
        if team_id not in {SPURS_ID, KNICKS_ID}:
            continue
        elapsed = elapsed_minutes(play)
        spurs_points = play["awayScore"]
        knicks_points = play["homeScore"]
        rows.append(
            {
                "sequence": int(play["sequenceNumber"]),
                "period": int(play["period"]["number"]),
                "clock": play["clock"]["displayValue"],
                "game_time": game_time_label(elapsed),
                "elapsed_minutes": elapsed,
                "event_team": "Spurs" if team_id == SPURS_ID else "Knicks",
                "score_value": int(play.get("scoreValue", 0)),
                "spurs_points": int(spurs_points),
                "knicks_points": int(knicks_points),
                "spurs_lead": int(spurs_points) - int(knicks_points),
                "description": play["text"],
            }
        )
    return pd.DataFrame(rows).sort_values("sequence").reset_index(drop=True)


def build_event_bins(scoring: pd.DataFrame, break_time: float) -> pd.DataFrame:
    boundaries = [break_time]

    cursor = break_time
    while cursor > 0:
        cursor = max(0.0, cursor - BIN_WIDTH_MINUTES)
        boundaries.append(cursor)

    cursor = break_time
    while cursor < GAME_LENGTH_MINUTES:
        cursor = min(GAME_LENGTH_MINUTES, cursor + BIN_WIDTH_MINUTES)
        boundaries.append(cursor)

    boundaries = sorted(set(boundaries))
    rows = []
    for start, end in zip(boundaries[:-1], boundaries[1:]):
        if end <= start:
            continue
        # Plays exactly on the max-lead break are classified as pre-break:
        # they create the peak lead; the collapse/surge begins afterward.
        mask = (scoring["elapsed_minutes"] > start) & (scoring["elapsed_minutes"] <= end)
        if abs(end - break_time) < 1e-9:
            mask = (scoring["elapsed_minutes"] > start) & (scoring["elapsed_minutes"] <= end)
        elif abs(start - break_time) < 1e-9:
            mask = (scoring["elapsed_minutes"] > start) & (scoring["elapsed_minutes"] <= end)

        window = scoring.loc[mask]
        duration = end - start
        spurs_points = int(window.loc[window["event_team"] == "Spurs", "score_value"].sum())
        knicks_points = int(window.loc[window["event_team"] == "Knicks", "score_value"].sum())
        rows.append(
            {
                "start_elapsed": start,
                "end_elapsed": end,
                "mid_event_time": ((start + end) / 2.0) - break_time,
                "duration_minutes": duration,
                "post_break": int(start >= break_time),
                "spurs_points": spurs_points,
                "knicks_points": knicks_points,
                "spurs_ppm": spurs_points / duration,
                "knicks_ppm": knicks_points / duration,
            }
        )
    return pd.DataFrame(rows)


def fit_rate_model(bins: pd.DataFrame, team: str):
    y = bins[f"{team.lower()}_ppm"]
    x = sm.add_constant(bins["post_break"])
    model = sm.WLS(y, x, weights=bins["duration_minutes"])
    result = model.fit().get_robustcov_results(cov_type="HC1")
    params = pd.Series(result.params, index=["const", "post_break"])
    conf = pd.DataFrame(result.conf_int(), index=["const", "post_break"], columns=["ci_low", "ci_high"])
    pvalues = pd.Series(result.pvalues, index=["const", "post_break"])
    pre_rate = params["const"]
    post_change = params["post_break"]
    post_rate = pre_rate + post_change
    return {
        "team": team,
        "pre_rate": pre_rate,
        "post_change": post_change,
        "post_rate": post_rate,
        "post_change_ci_low": conf.loc["post_break", "ci_low"],
        "post_change_ci_high": conf.loc["post_break", "ci_high"],
        "post_change_p": pvalues["post_break"],
        "n_bins": int(result.nobs),
    }


def score_at_grid(scoring: pd.DataFrame, step: float = 0.1) -> pd.DataFrame:
    grid = pd.DataFrame({"elapsed_minutes": [round(i * step, 10) for i in range(int(GAME_LENGTH_MINUTES / step) + 1)]})
    scores = scoring[["elapsed_minutes", "spurs_points", "knicks_points", "spurs_lead"]].copy()
    start = pd.DataFrame(
        [{"elapsed_minutes": 0.0, "spurs_points": 0, "knicks_points": 0, "spurs_lead": 0}]
    )
    scores = pd.concat([start, scores], ignore_index=True).sort_values("elapsed_minutes")
    merged = pd.merge_asof(grid, scores, on="elapsed_minutes", direction="backward")
    return merged.fillna(0)


def write_chart(scoring: pd.DataFrame, break_row: pd.Series) -> Path:
    chart_path = OUTPUT_DIR / "spurs_knicks_event_study_401859966.png"
    grid = score_at_grid(scoring)

    plt.style.use("seaborn-v0_8-whitegrid")
    fig, axes = plt.subplots(2, 1, figsize=(11, 8), sharex=True, gridspec_kw={"height_ratios": [2, 1]})

    axes[0].plot(grid["elapsed_minutes"], grid["spurs_points"], color="#111111", linewidth=2.4, label="Spurs")
    axes[0].plot(grid["elapsed_minutes"], grid["knicks_points"], color="#1d428a", linewidth=2.4, label="Knicks")
    axes[0].axvline(break_row["elapsed_minutes"], color="#d55e00", linestyle="--", linewidth=1.6)
    axes[0].set_ylabel("Cumulative points")
    axes[0].legend(loc="upper left", frameon=True)
    axes[0].set_title("Knicks-Spurs Game 4 scoring trajectory")

    axes[1].plot(grid["elapsed_minutes"], grid["spurs_lead"], color="#444444", linewidth=2.2)
    axes[1].axhline(0, color="#777777", linewidth=1)
    axes[1].axvline(break_row["elapsed_minutes"], color="#d55e00", linestyle="--", linewidth=1.6)
    axes[1].scatter([break_row["elapsed_minutes"]], [break_row["spurs_lead"]], color="#d55e00", zorder=5)
    axes[1].set_ylabel("Spurs lead")
    axes[1].set_xlabel("Elapsed game minutes")

    tick_positions = list(range(0, 49, 6))
    axes[1].set_xticks(tick_positions)
    axes[1].set_xticklabels([game_time_label(tick) for tick in tick_positions], rotation=0)

    fig.text(
        0.5,
        0.01,
        f"Break: max Spurs lead of {break_row['spurs_lead']} at {break_row['game_time']} "
        f"({break_row['spurs_points']}-{break_row['knicks_points']})",
        ha="center",
        fontsize=10,
    )
    fig.tight_layout(rect=[0, 0.04, 1, 1])
    fig.savefig(chart_path, dpi=180)
    plt.close(fig)
    return chart_path


def write_regression_plot(bins: pd.DataFrame) -> Path:
    plot_path = OUTPUT_DIR / "spurs_knicks_regression_lines_401859966.png"
    colors = {"Spurs": "#111111", "Knicks": "#1d428a"}
    markers = {"Spurs": "o", "Knicks": "s"}

    fig, ax = plt.subplots(figsize=(11, 6))
    for team in ["Spurs", "Knicks"]:
        key = team.lower()
        pre = bins.loc[bins["post_break"] == 0]
        post = bins.loc[bins["post_break"] == 1]
        pre_rate = pre[f"{key}_points"].sum() / pre["duration_minutes"].sum()
        post_rate = post[f"{key}_points"].sum() / post["duration_minutes"].sum()

        ax.scatter(
            bins["mid_event_time"],
            bins[f"{key}_ppm"],
            s=38,
            alpha=0.62,
            marker=markers[team],
            color=colors[team],
            edgecolor="white",
            linewidth=0.45,
            label=f"{team} raw bins",
        )
        ax.hlines(
            pre_rate,
            xmin=pre["mid_event_time"].min(),
            xmax=pre["mid_event_time"].max(),
            color=colors[team],
            linewidth=3,
            label=f"{team} fitted pre",
        )
        ax.hlines(
            post_rate,
            xmin=post["mid_event_time"].min(),
            xmax=post["mid_event_time"].max(),
            color=colors[team],
            linewidth=3,
            linestyle="--",
            label=f"{team} fitted post",
        )

    ax.axvline(0, color="#d55e00", linestyle="--", linewidth=1.8)
    ax.set_title("Event-study scoring-rate regressions")
    ax.set_xlabel("Minutes relative to latest 29-point Spurs lead")
    ax.set_ylabel("Points per minute in 30-second bin")
    ax.set_xlim(bins["mid_event_time"].min() - 0.25, bins["mid_event_time"].max() + 0.25)
    ax.set_ylim(bottom=-0.25)
    ax.legend(ncol=2, frameon=True, fontsize=9)
    ax.grid(True, color="#d0d0d0", linewidth=0.9)
    fig.tight_layout()
    fig.savefig(plot_path, dpi=180)
    plt.close(fig)
    return plot_path


def write_summary(
    scoring: pd.DataFrame,
    bins: pd.DataFrame,
    regression: pd.DataFrame,
    break_row: pd.Series,
    first_max_row: pd.Series,
) -> Path:
    summary_path = OUTPUT_DIR / "event_study_summary_401859966.md"

    pre_duration = float(bins.loc[bins["post_break"] == 0, "duration_minutes"].sum())
    post_duration = float(bins.loc[bins["post_break"] == 1, "duration_minutes"].sum())
    pre_spurs = int(bins.loc[bins["post_break"] == 0, "spurs_points"].sum())
    post_spurs = int(bins.loc[bins["post_break"] == 1, "spurs_points"].sum())
    pre_knicks = int(bins.loc[bins["post_break"] == 0, "knicks_points"].sum())
    post_knicks = int(bins.loc[bins["post_break"] == 1, "knicks_points"].sum())
    spurs_pre_rate = pre_spurs / pre_duration
    spurs_post_rate = post_spurs / post_duration
    knicks_pre_rate = pre_knicks / pre_duration
    knicks_post_rate = post_knicks / post_duration
    final_lead = int(scoring.iloc[-1]["spurs_lead"])
    gap_closure = int(break_row["spurs_lead"] - final_lead)

    spurs = regression.loc[regression["team"] == "Spurs"].iloc[0]
    knicks = regression.loc[regression["team"] == "Knicks"].iloc[0]
    spurs_shortfall = -spurs["post_change"] * post_duration
    knicks_gain = knicks["post_change"] * post_duration
    choke_to_surge_ratio = abs(spurs["post_change"]) / abs(knicks["post_change"])
    choke_share = spurs_shortfall / (spurs_shortfall + knicks_gain)
    pre_rate_momentum = (spurs_pre_rate - knicks_pre_rate) * post_duration

    knicks_pre_benchmark = knicks_pre_rate
    spurs_shortfall_vs_knicks_pre = (knicks_pre_benchmark - spurs_post_rate) * post_duration
    knicks_gain_vs_knicks_pre = (knicks_post_rate - knicks_pre_benchmark) * post_duration

    knicks_post_benchmark = knicks_post_rate
    spurs_shortfall_vs_knicks_post = (knicks_post_benchmark - spurs_post_rate) * post_duration
    knicks_gain_vs_knicks_post = (knicks_post_rate - knicks_post_benchmark) * post_duration

    lines = [
        "# Spurs-Knicks Event Study",
        "",
        "Source: ESPN public event summary API for event `401859966`.",
        "",
        "## Break",
        "",
        (
            f"The Spurs' maximum lead was {int(break_row['spurs_lead'])}. It was first reached at "
            f"{first_max_row['game_time']} and last reached at {break_row['game_time']}."
        ),
        (
            f"The event-study break uses the last maximum-lead timestamp: {break_row['description']} "
            f"(Spurs {int(break_row['spurs_points'])}, Knicks {int(break_row['knicks_points'])})."
        ),
        "",
        "## Raw Split",
        "",
        "| Split | Minutes | Spurs points | Knicks points | Margin |",
        "|---|---:|---:|---:|---:|",
        f"| Pre-break, including last max-lead play | {pre_duration:.2f} | {pre_spurs} | {pre_knicks} | {pre_spurs - pre_knicks:+d} |",
        f"| Post-break | {post_duration:.2f} | {post_spurs} | {post_knicks} | {post_spurs - post_knicks:+d} |",
        "",
        "## Regressions",
        "",
        (
            "Model: 30-second event-time bins, weighted by bin duration. "
            "`points_per_minute = alpha + tau * post_break + error`."
        ),
        "",
        "| Team | Pre-break ppm | Post-break ppm | Post change ppm | 95% CI for change | p-value |",
        "|---|---:|---:|---:|---:|---:|",
    ]

    for _, row in regression.iterrows():
        lines.append(
            f"| {row['team']} | {row['pre_rate']:.3f} | {row['post_rate']:.3f} | "
            f"{row['post_change']:+.3f} | [{row['post_change_ci_low']:+.3f}, {row['post_change_ci_high']:+.3f}] | "
            f"{row['post_change_p']:.3f} |"
        )

    lines.extend(
        [
            "",
            "## Attribution",
            "",
            f"Observed gap closure: {gap_closure} points, from Spurs +{int(break_row['spurs_lead'])} to {final_lead:+d}.",
            "",
            "### Own pre-rate counterfactual",
            "",
            (
                f"Using each team's own pre-break rate, the Spurs' post-break coefficient implies "
                f"{spurs_shortfall:.1f} lost points, while the Knicks' coefficient implies "
                f"{knicks_gain:.1f} added points."
            ),
            (
                f"Those two coefficients sum to {spurs_shortfall + knicks_gain:.1f} points of deviation "
                f"from pre-break trends, not {gap_closure}, because the Spurs' pre-break pace would have "
                f"widened the lead by another {pre_rate_momentum:.1f} points."
            ),
            (
                f"On this trend-deviation basis: Spurs falloff {choke_share:.0%}, "
                f"Knicks surge {1 - choke_share:.0%}."
            ),
            "",
            "### Knicks common benchmarks",
            "",
            "| Benchmark | Spurs falloff | Knicks surge | Spurs share | Knicks share |",
            "|---|---:|---:|---:|---:|",
            (
                f"| Knicks pre-break rate ({knicks_pre_rate:.3f} ppm) | "
                f"{spurs_shortfall_vs_knicks_pre:.1f} | {knicks_gain_vs_knicks_pre:.1f} | "
                f"{spurs_shortfall_vs_knicks_pre / gap_closure:.0%} | "
                f"{knicks_gain_vs_knicks_pre / gap_closure:.0%} |"
            ),
            (
                f"| Knicks post-break rate ({knicks_post_rate:.3f} ppm) | "
                f"{spurs_shortfall_vs_knicks_post:.1f} | {knicks_gain_vs_knicks_post:.1f} | "
                f"{spurs_shortfall_vs_knicks_post / gap_closure:.0%} | "
                f"{knicks_gain_vs_knicks_post / gap_closure:.0%} |"
            ),
        ]
    )

    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            (
                f"Relative to their own pre-break pace, the Spurs lost about {spurs_shortfall:.1f} expected "
                f"points after the break, while the Knicks added about {knicks_gain:.1f} expected points."
            ),
            (
                f"By scoring-rate change, the Spurs' collapse was about {choke_to_surge_ratio:.1f}x as large "
                f"as the Knicks' surge. The Spurs-side shortfall accounts for roughly {choke_share:.0%} of the "
                "combined post-break deviation from pre-break pace."
            ),
        ]
    )
    summary_path.write_text("\n".join(lines) + "\n")
    return summary_path


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with RAW_PATH.open() as f:
        summary = json.load(f)

    scoring = scoring_timeline(summary)
    scoring_path = DATA_DIR / "scoring_timeline_401859966.csv"
    scoring.to_csv(scoring_path, index=False)

    max_lead = scoring["spurs_lead"].max()
    max_rows = scoring.loc[scoring["spurs_lead"] == max_lead]
    first_max_row = max_rows.iloc[0]
    break_row = max_rows.iloc[-1]

    bins = build_event_bins(scoring, float(break_row["elapsed_minutes"]))
    bins_path = OUTPUT_DIR / "event_study_bins_401859966.csv"
    bins.to_csv(bins_path, index=False)

    regression = pd.DataFrame([fit_rate_model(bins, "Spurs"), fit_rate_model(bins, "Knicks")])
    regression_path = OUTPUT_DIR / "event_study_regressions_401859966.csv"
    regression.to_csv(regression_path, index=False)

    chart_path = write_chart(scoring, break_row)
    regression_plot_path = write_regression_plot(bins)
    summary_path = write_summary(scoring, bins, regression, break_row, first_max_row)

    print(f"Scoring timeline: {scoring_path}")
    print(f"Event bins: {bins_path}")
    print(f"Regressions: {regression_path}")
    print(f"Chart: {chart_path}")
    print(f"Regression plot: {regression_plot_path}")
    print(f"Summary: {summary_path}")
    print()
    print(summary_path.read_text())


if __name__ == "__main__":
    main()

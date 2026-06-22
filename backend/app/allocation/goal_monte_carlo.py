from __future__ import annotations

import math
import random
import time

from .goal_manager import required_monthly_linear


def _success_rate(
    initial_amount: float,
    monthly_contribution: float,
    target_amount: float,
    horizon_years: float,
    annual_return_mean: float,
    annual_return_std: float,
    n_paths: int,
    seed: int,
) -> float:
    rng = random.Random(seed)
    n_steps = max(1, int(horizon_years * 12))
    monthly_mean = annual_return_mean / 12.0
    monthly_std = max(0.0, annual_return_std) / math.sqrt(12.0)
    success = 0
    for _ in range(n_paths):
        value = initial_amount
        for _month in range(n_steps):
            value = value * (1 + rng.gauss(monthly_mean, monthly_std)) + monthly_contribution
            if value < 0:
                value = 0
        if value >= target_amount:
            success += 1
    return success / n_paths


def bisect_monthly_contribution(
    initial_amount: float,
    target_amount: float,
    horizon_years: float,
    annual_return_mean: float,
    annual_return_std: float,
    target_success_rate: float = 0.8,
    n_paths: int = 400,
    max_iter: int = 24,
    tolerance: float = 50.0,
    timeout_seconds: float = 8.0,
    seed: int = 42,
) -> tuple[float, bool, str | None]:
    started_at = time.monotonic()
    fallback_value = required_monthly_linear(
        initial_amount=initial_amount,
        target_amount=target_amount,
        horizon_years=horizon_years,
        annual_return_mean=annual_return_mean,
    )
    if target_amount <= initial_amount:
        return 0.0, False, None

    lo = 0.0
    hi = max(fallback_value * 1.8, (target_amount - initial_amount) / max(1, horizon_years * 12))
    hi = max(hi, 100.0)

    if time.monotonic() - started_at > timeout_seconds:
        return fallback_value, True, "timeout_linear_approximation"

    if _success_rate(
        initial_amount,
        hi,
        target_amount,
        horizon_years,
        annual_return_mean,
        annual_return_std,
        n_paths,
        seed,
    ) < target_success_rate:
        return hi, True, "upper_bound_insufficient"

    fallback_reason: str | None = None
    fallback_used = False
    for iteration in range(max_iter):
        if time.monotonic() - started_at > timeout_seconds:
            return fallback_value, True, "timeout_linear_approximation"
        mid = (lo + hi) / 2
        rate = _success_rate(
            initial_amount,
            mid,
            target_amount,
            horizon_years,
            annual_return_mean,
            annual_return_std,
            n_paths,
            seed + iteration,
        )
        if rate < target_success_rate:
            lo = mid
        else:
            hi = mid
        if hi - lo < tolerance:
            break

    return hi, fallback_used, fallback_reason

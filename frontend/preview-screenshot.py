from playwright.sync_api import sync_playwright
import os

OUTPUT_DIR = r"d:\Workspace\Fundtrader\frontend\preview"
os.makedirs(OUTPUT_DIR, exist_ok=True)

ROUTES = [
    ("http://127.0.0.1:3000/fund/allocation/result", "01-overview"),
    ("http://127.0.0.1:3000/fund/allocation/result/market", "02-market"),
    ("http://127.0.0.1:3000/fund/allocation/result/strategy", "03-strategy"),
    ("http://127.0.0.1:3000/fund/allocation/result/funds", "04-funds"),
    ("http://127.0.0.1:3000/fund/allocation/result/risk", "05-risk"),
    ("http://127.0.0.1:3000/fund/allocation/ops", "06-ops"),
    ("http://127.0.0.1:3000/fund/allocation/plans", "07-plans"),
    ("http://127.0.0.1:3000/fund/allocation/simulator", "08-simulator"),
    ("http://127.0.0.1:3000/fund/allocation/backtest", "09-backtest"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    for url, name in ROUTES:
        print(f"Capturing {name}...")
        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(1500)
            page.screenshot(path=os.path.join(OUTPUT_DIR, f"{name}.png"), full_page=True)
            print(f"  ✓ {name}.png saved")
        except Exception as e:
            print(f"  ✗ {name} failed: {e}")

    browser.close()
    print(f"\nAll screenshots saved to {OUTPUT_DIR}")

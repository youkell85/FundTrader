# FT-P0-2 - 鏁版嵁婧愬仴搴风姸鎬佷笌瀛楁婧愪俊鎭彲瑙佸寲

Created: 2026-06-18T00:00:00+08:00
PM: Codex
Executor: Claude Code via cc-switch

## Goal

瀹屾垚 FundTrader DSA-P0 鐨?FT-P0-2锛氬疄鐜版暟鎹簮鍋ュ悍鐘舵€佹€昏鎺ュ彛锛屽苟鎶婂瓧娈电骇 `source`/`status`/`missingReason` 鐨勫彲瑙嗗寲涓庡悗绔彁渚涜兘鍔涘浐鍖栦负楠岃瘉缁撴灉銆?
## Context

- 褰撳墠浠撳簱: FundTrader
- 褰撳墠浠诲姟璐熻矗浜? Codex PM
- 鎵ц瑙掕壊: Claude 浠呰礋璐ｇ紪鐮佷笌鏈湴楠岃瘉
- 鍏抽敭鑳屾櫙:
  - 淇濈暀鏃犲叧宸ヤ綔鏍戝彉鏇?  - 鑻ヤ粨搴撶姸鎬佷笌浠诲姟鍋囪鍋忕锛屽厛鍥炴姤骞剁‘璁?
## Approved Scope

鍏佽缂栬緫鑼冨洿锛?
- `backend/app/data/data_gateway.py`
- `backend/app/data/providers/base.py`
- `backend/app/data/providers/*_provider.py`
- `backend/app/api/health.py`
- `backend/app/main.py`
- `tests/test_dsa_p0_fields_provider_health.py`
- `frontend/api/fund-router.ts`
- `frontend/api/lib/mapper.ts`
- `frontend/src/pages/FundDetail`
- `frontend/src/components`
- `frontend/src/api`

涓嶅緱缂栬緫锛?
- `.env` / 瀵嗛挜
- `backend/data/fundtrader.db`
- 閮ㄧ讲鑴氭湰涓庤繍缁村叆鍙?- `docs/pm/outbox`, `docs/pm/running`, `docs/pm/logs`
- Git 鍘嗗彶銆佸垎鏀€佽繙绔?
## Allowed Files

- `backend/`
- `tests/`
- `docs/pm/`
- .env
- `backend/app/`
- `tests/`
## Required Repo Check Before Editing

鎵ц骞舵€荤粨锛?
```powershell
git log --oneline -5
git rev-parse --short HEAD
git status --short --untracked-files=all
```

鑻ユ湁涓嶇浉鍏冲彉鏇达紝浠呬繚鐣欏苟缁х画鍦ㄦ湰浠诲姟鑼冨洿鍐呰惤鍦般€?
## Implementation Tasks

1. 瀹炵幇 provider health model 涓庤仛鍚?   - 鍦ㄥ悗绔暟鎹眰琛ラ綈 provider 鑳藉姏鐘舵€佹ā鍨嬶紙濡?`capabilities`, `status`, `lastSuccess`, `lastError`, `cooldownUntil`锛?   - 瑕嗙洊 `tushare`, `ifind`, `tickflow`, `tencent`, `akshare`锛堟垨褰撳墠瀹炵幇涓殑瀹為檯 provider锛?   - 鐘舵€佷娇鐢?`available/partial/stale/missing/unknown` 绛夌ǔ瀹氳涔?
2. 鎻愪緵 `/fund/api/data-sources/status` 鎺ュ彛
   - 浠?`backend/app/api/health.py` 鏆撮湶鍑哄彲璇讳笖绋冲畾鐨勭姸鎬佸垪琛?   - 杩斿洖缁撴瀯鍖呭惈 `providerName`銆乣capabilities`銆乣status`銆乣lastSuccess`銆乣lastError`銆乣cooldownUntil`
   - 纭繚涓婚〉闈㈣姹傞摼璺笉鍥犺鐘舵€佹煡璇㈤樆濉?
3. 鍓嶇瀛楁鍙鎬т笌缂哄彛闈㈡澘
   - 灏?`source`銆乣status`銆乣missingReason` 鍦?Detail 椤甸潰閫忎紶骞跺睍绀?   - DataGapsPanel锛堟垨鍚岀被缁勪欢锛夊睍绀轰笉瀹屾暣瀛楁鏉ユ簮涓庣姸鎬?   - 閬垮厤鈥滈潤榛樺厹搴曗€濓紝瀵?`unknown/missing` 鍋氭槑纭彁绀?
4. 娴嬭瘯涓庡洖褰?   - 鍚庣琛ラ綈 provider health 涓?endpoint 鐨勬祴璇?   - 鍓嶇濡傛湁鍙惤鐨勭粍浠舵垨鏄犲皠鍗曟祴涓€骞惰ˉ鍏?
## Contracts And Design Decisions

- 涓?`/fund/api/*` 鐨勮繑鍥炵粨鏋勫吋瀹癸紝涓嶅湪鏈换鍔″唴寮曞叆鏂板瓧娈垫浛鎹㈢幇鏈夊瓧娈靛悕
- 涓嶄吉閫犲仴搴风姸鎬侊紱鏃犵湡瀹炴潵婧愭椂杩斿洖 `unknown/missing` 涓斿甫鍘熷洜
- 涓?FT-P0-1 瀛楁鏉ユ簮绾﹀畾涓€鑷?
## Validation

```powershell
cd D:\Workspace\Fundtrader\backend
python -m pytest -q
cd D:\Workspace\Fundtrader\frontend
npm.cmd run check
npm.cmd run build
cd D:\Workspace\Fundtrader
curl.exe -s http://127.0.0.1:8766/fund/api/health
curl.exe -s http://127.0.0.1:8766/fund/api/data-sources/status
```

棰勬湡缁撴灉锛?
- `/fund/api/data-sources/status` 杩斿洖瀹屾暣 provider 鍋ュ悍鐘舵€?- 鏁版嵁璇︽儏鍙睍绀哄瓧娈垫潵婧愪笌缂哄け鍘熷洜
- 妫€鏌ヤ笌鏋勫缓鍛戒护閫氳繃

## Acceptance Criteria

- 鏁版嵁婧愬仴搴风鐐规寜绾﹀畾杩斿洖 provider 鐘舵€?- 璇︽儏椤甸潰鏄剧ず瀛楁绾у彲杩芥函淇℃伅
- `backend/`frontend 鏍￠獙

## Stop Conditions

- 鏁版嵁婧愬垪琛ㄤ笌瀹為檯杩愯閰嶇疆涓嶄竴鑷翠笖鏃犳硶纭
- 浠诲姟澶栧彉鏇达紙渚嬪鎸佷箙鍖?schema 鍙樻洿锛夋垚涓哄繀瑕?- 鍏抽敭渚濊禆缂哄け瀵艰嚧鎺ュ彛鏃犳硶绋冲畾鎻愪緵

## Final Report Required

鎾板啓 `docs/pm/reports/FT-P0-2.md`锛屾寜 `## PM Digest` 杈撳嚭锛?
1. Status
2. Changed
3. Validation
4. Risk
5. Decision
6. Next

骞堕檮涓婂彉鏇存枃浠躲€佹牎楠屽懡浠ゃ€乻cope/safety銆佸悗缁姩浣滃缓璁€?










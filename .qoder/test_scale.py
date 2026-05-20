import urllib.request
import json

url = "http://localhost:8766/fund/list?guoyuan_only=true&page_size=5"
req = urllib.request.Request(url)
with urllib.request.urlopen(req, timeout=60) as resp:
    data = json.loads(resp.read().decode())
    
print("total:", data.get("total"))
funds = data.get("funds", [])
for f in funds[:5]:
    code = f.get("code", "--")
    name = f.get("name", "")[:15]
    scale = f.get("total_scale", "--")
    print(code, name, "scale:", scale)
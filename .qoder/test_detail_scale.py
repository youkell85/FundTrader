import urllib.request
import json

# 测试基金详情 API（001938 是用户提到的基金）
url = "http://localhost:8766/analysis/001938"
req = urllib.request.Request(url)
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode())
    
print("code:", data.get("code"))
print("name:", data.get("name"))
print("nav:", data.get("nav"))
print("total_scale:", data.get("total_scale"))
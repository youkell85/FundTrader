import efinance as ef

# 查看 efinance.fund 模块的所有方法
print("efinance.fund methods:")
for attr in dir(ef.fund):
    if not attr.startswith('_'):
        print(attr)
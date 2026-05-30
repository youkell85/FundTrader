import os, json
base = r"D:\Workspace\Fundtraderrontend\src"

FILES = {}

# ---- Wizard page (compact) ----
FILES["pages/AllocationWizard.tsx"] = open("WIZARD_SRC", "r").read()

for fname, content in FILES.items():
    fp = os.path.join(base, fname)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w", encoding="utf-8") as fh:
        fh.write(content)
    print(fname, len(content), "chars")

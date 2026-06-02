import { useEffect, useState } from "react";

/**
 * 顶部粘性锚点导航条。监听 scroll，自动高亮当前 section。
 * 实现基于 IntersectionObserver，零依赖。
 */
type AnchorItem = { id: string; label: string };

type AnchorNavProps = {
  items: AnchorItem[];
};

export function AnchorNav({ items }: AnchorNavProps) {
  const [active, setActive] = useState<string>(items[0]?.id ?? "");

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // 选最靠近视口顶部的可见 section
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target?.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    items.forEach((it) => {
      const el = document.getElementById(it.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav className="sticky top-14 z-30 -mx-3 mt-3 border-y bg-background/85 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:-mx-5 md:px-5">
      <div className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto">
        {items.map((it) => {
          const isActive = active === it.id;
          return (
            <a
              key={it.id}
              href={`#${it.id}`}
              className={
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors " +
                (isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground")
              }
            >
              {it.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

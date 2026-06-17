import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * 锚点 section。每个 section 自带 id，可被顶部 AnchorNav 跳转。
 * 当 defaultExpanded=false 时，标题变为可折叠触发器，内容默认收起。
 */
type ReportSectionProps = {
  id: string;
  title?: string;
  badge?: string;
  children: ReactNode;
  /** 默认展开。设为 false 时内容折叠，点击标题展开。默认 true。 */
  defaultExpanded?: boolean;
};

export function ReportSection({ id, title, badge, children, defaultExpanded = true }: ReportSectionProps) {
  const [open, setOpen] = useState(defaultExpanded);

  const header = title ? (
    <div className="flex items-center gap-2">
      {defaultExpanded ? null : (
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
      )}
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {badge ? (
        <span className="rounded border border-dashed border-white/15 px-2 py-0.5 text-[11px] font-normal text-white/50">
          {badge}
        </span>
      ) : null}
    </div>
  ) : null;

  if (defaultExpanded) {
    return (
      <section id={id} className="scroll-mt-24 space-y-3">
        {header}
        {children}
      </section>
    );
  }

  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full cursor-pointer select-none text-left hover:text-foreground">
          {header}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3 data-[state=closed]:hidden">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

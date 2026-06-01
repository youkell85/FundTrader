import { Search, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const typeLabels: Record<string, string> = {
  equity: "股票型",
  hybrid: "混合型",
  bond: "债券型",
  index: "指数型",
  etf: "ETF",
  qdii: "QDII",
  money: "货币型",
  fof: "FOF",
  reits: "REITs",
};

const riskLabels: Record<string, string> = {
  low: "低风险",
  low_medium: "中低风险",
  medium: "中风险",
  medium_high: "中高风险",
  high: "高风险",
};

interface FilterBarProps {
  search: string;
  searchError: string | null;
  fundType: string;
  category: string;
  company: string;
  riskLevel: string;
  showXinjihui: boolean;
  showWatchlist: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  filterOpts: { types: string[]; categories: string[]; companies: string[]; riskLevels: string[] };
  addFundByCodePending: boolean;
  onSearchChange: (value: string) => void;
  onSearchSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  onFundTypeChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onCompanyChange: (value: string) => void;
  onRiskLevelChange: (value: string) => void;
  onToggleXinjihui: () => void;
  onToggleWatchlist: () => void;
  onSortChange: (key: string) => void;
}

export default function FilterBar(props: FilterBarProps) {
  const {
    search,
    searchError,
    fundType,
    category,
    company,
    riskLevel,
    showXinjihui,
    showWatchlist,
    sortBy,
    sortOrder,
    filterOpts,
    addFundByCodePending,
    onSearchChange,
    onSearchSubmit,
    onFundTypeChange,
    onCategoryChange,
    onCompanyChange,
    onRiskLevelChange,
    onToggleXinjihui,
    onToggleWatchlist,
    onSortChange,
  } = props;

  return (
    <div className="mt-8">
      <div className="flex flex-col md:flex-row gap-3">
        <form className="relative flex-1" onSubmit={onSearchSubmit}>
          <button
            type="submit"
            disabled={addFundByCodePending}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/60 transition-colors disabled:opacity-50"
            title="搜索基金"
          >
            {addFundByCodePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="输入基金代码 / 名称 / 基金经理..."
            aria-label="搜索基金"
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-white/[0.03] border border-white/[0.06] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-[#3B6CFF]/50 focus:bg-white/[0.05] transition-all"
          />
          {searchError && <div className="absolute left-0 top-full mt-1 text-xs text-[#FF3366]">{searchError}</div>}
        </form>

        <div className="flex gap-2 flex-wrap">
          <Select value={fundType} onValueChange={onFundTypeChange}>
            <SelectTrigger className="h-11 min-w-[110px] px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm data-[placeholder]:text-white/50">
              <SelectValue placeholder="基金类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">基金类型</SelectItem>
              {Object.entries(typeLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={riskLevel} onValueChange={onRiskLevelChange}>
            <SelectTrigger className="h-11 min-w-[110px] px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm data-[placeholder]:text-white/50">
              <SelectValue placeholder="风险类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">风险类型</SelectItem>
              {Object.entries(riskLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger className="h-11 min-w-[110px] px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm data-[placeholder]:text-white/50">
              <SelectValue placeholder="题材类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">题材类型</SelectItem>
              {filterOpts.categories?.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={company} onValueChange={onCompanyChange}>
            <SelectTrigger className="h-11 min-w-[110px] px-3 rounded-xl bg-[#0B1021] border border-white/[0.08] text-white text-sm data-[placeholder]:text-white/50">
              <SelectValue placeholder="基金公司" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">基金公司</SelectItem>
              {filterOpts.companies?.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={onToggleXinjihui}
            className={`h-11 px-4 rounded-xl text-sm font-medium transition-all ${
              showXinjihui
                ? "bg-[#3B6CFF]/20 text-[#00F0FF] border border-[#3B6CFF]/30"
                : "bg-white/[0.03] text-white/50 border border-white/[0.06] hover:bg-white/[0.06]"
            }`}
          >
            鑫基荟
          </button>
          <button
            onClick={onToggleWatchlist}
            className={`h-11 px-4 rounded-xl text-sm font-medium transition-all ${
              showWatchlist
                ? "bg-[#3B6CFF]/20 text-[#00F0FF] border border-[#3B6CFF]/30"
                : "bg-white/[0.03] text-white/50 border border-white/[0.06] hover:bg-white/[0.06]"
            }`}
          >
            自选
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-white/50 text-xs">排序:</span>
        {[
          { key: "dailyChange", label: "日涨跌" },
          { key: "return1y", label: "近1年" },
          { key: "sharpeRatio", label: "夏普" },
          { key: "maxDrawdown", label: "回撤" },
          { key: "nav", label: "净值" },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => onSortChange(s.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              sortBy === s.key
                ? "bg-[#3B6CFF]/15 text-[#00F0FF]"
                : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
            }`}
          >
            {s.label} {sortBy === s.key && (sortOrder === "desc" ? "↓" : "↑")}
          </button>
        ))}
      </div>
    </div>
  );
}

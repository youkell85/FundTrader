import type { FundDetailViewModel } from "../useFundDetailData";

export type FundDetailTabKey =
  | "overview"
  | "performance"
  | "holdings"
  | "market"
  | "diagnosis";

export type FundDetailTabProps = {
  detail: FundDetailViewModel;
  onSelectTab: (tab: FundDetailTabKey) => void;
};

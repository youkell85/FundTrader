import { type DetailRowsPayload, realRows } from "@/lib/detail-status";
import { ReportSection } from "@/components/report/ReportSection";
import {
  AllocationSection,
  HoldingsSection,
  ManagerSection,
  MetaSection,
  ScaleSection,
  type TurnoverRow,
} from "../sections";
import type { FundDetailTabProps } from "./types";

export default function HoldingsTab({ detail }: FundDetailTabProps) {
  return (
    <div className="mt-3 space-y-6">
      <ReportSection id="alloc" title="持仓与资产配置">
        <AllocationSection
          fund={detail.fund}
          industryHistoryData={detail.industryHistoryData}
          holderStructure={realRows(
            detail.holderStructureQ.data as DetailRowsPayload<{
              quarter: string;
              institution: number;
              individual: number;
              linkedFund?: number | null;
            }>,
          )}
          holderStatus={
            detail.holderStructureQ.data as DetailRowsPayload<{
              quarter: string;
              institution: number;
              individual: number;
              linkedFund?: number | null;
            }>
          }
          bondAllocation={realRows(
            detail.bondAllocationQ.data as DetailRowsPayload<{
              bondType: string;
              ratio: number;
              changeRatio: number | null;
            }>,
          )}
          bondAllocationStatus={
            detail.bondAllocationQ.data as DetailRowsPayload<{
              bondType: string;
              ratio: number;
              changeRatio: number | null;
            }>
          }
        />
        <div className="mt-3">
          <HoldingsSection
            fund={detail.fund}
            bondHoldings={realRows(detail.bondHoldingsQ.data as DetailRowsPayload<any>)}
            bondHoldingsStatus={detail.bondHoldingsQ.data as DetailRowsPayload<any>}
          />
        </div>
      </ReportSection>

      <ReportSection id="scale" title="规模 · 换手 · 持有人结构">
        <ScaleSection
          scaleRows={(detail.scaleHistoryQ.data?.rows || []) as Array<{
            quarter: string;
            totalScale: number;
            peer25Scale: number | null;
          }>}
          turnoverRows={(detail.turnoverHistoryQ.data?.rows || []) as TurnoverRow[]}
        />
      </ReportSection>

      <ReportSection id="manager" title="基金经理与运作分析">
        <ManagerSection
          fund={detail.fund}
          managerHistory={(detail.managerHistoryQ.data?.rows || []) as Array<{
            managerName: string;
            startDate: string;
            endDate: string | null;
            totalReturn: number | null;
            annualizedReturn: number | null;
            rank: { rank: number; total: number } | null;
          }>}
          managerReport={detail.managerReportQ.data}
        />
      </ReportSection>

      <ReportSection id="meta" title="购买信息 · 基金评级 · 数据覆盖">
        <MetaSection
          fund={detail.fund}
          rating={detail.ratingQ.data}
          purchaseInfo={detail.purchaseInfoQ.data}
          completeness={detail.detailCompletenessQ.data}
          navPoints={detail.navPoints}
        />
      </ReportSection>
    </div>
  );
}

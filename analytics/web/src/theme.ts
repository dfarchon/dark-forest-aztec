import styled from "styled-components";

export const colors = {
  text: "#BBBBBB",
  subtext: "#838383",
  background: "#151515",
  border: "#777777",
  borderDark: "#5F5F5F",
  dfgreen: "#FFD0DA",
  dfred: "#FF6492",
  dfblue: "#00ADE1",
  dfyellow: "#e8e228",
  dfpurple: "#9189d9",
  dfwhite: "#ffffff",
  page: "#000000",
};

export const series = [
  colors.dfgreen,
  colors.dfred,
  colors.dfblue,
  colors.dfyellow,
  colors.dfpurple,
  colors.dfwhite,
  "#f5c082",
  "#46FB73",
  "#c46500",
  "#6b68ff",
  "#c13cff",
  "#f8b73e",
];

export function seriesColor(index: number): string {
  return series[index % series.length] ?? colors.dfgreen;
}

export const Page = styled.main`
  max-width: 1100px;
  margin: 0 auto;
  padding: 36px 20px 72px;
`;

export const PageTitle = styled.h1`
  margin: 0;
  font-family: "perfect_dos_vga_437regular", monospace;
  font-size: clamp(28px, 5vw, 42px);
  font-weight: 400;
  letter-spacing: 0.06em;
  color: ${colors.dfgreen};
`;

export const SeasonTitle = styled.p`
  margin: 8px 0 0;
  font-family: "perfect_dos_vga_437regular", monospace;
  font-size: clamp(18px, 3vw, 24px);
  letter-spacing: 0.14em;
  color: ${colors.text};
`;

export const EnterLink = styled.a`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 22px 0 4px;
  min-width: min(100%, 420px);
  padding: 18px 36px;
  background: ${colors.page};
  color: ${colors.dfgreen};
  border: 1px solid ${colors.dfgreen};
  border-radius: 3px;
  font-family: "perfect_dos_vga_437regular", monospace;
  font-size: clamp(20px, 3vw, 28px);
  letter-spacing: 0.08em;
  text-decoration: none;

  &:hover {
    background: ${colors.dfgreen};
    color: ${colors.page};
  }
`;

export const Subtitle = styled.p`
  margin: 8px 0 24px;
  color: ${colors.subtext};
`;

export const Cards = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
`;

export const Card = styled.div`
  min-width: 150px;
  flex: 1;
  background: ${colors.background};
  border: 1px solid ${colors.borderDark};
  border-radius: 3px;
  padding: 14px 16px;
`;

export const CardValue = styled.b`
  display: block;
  color: ${colors.dfwhite};
  font-size: 22px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

export const CardLabel = styled.span`
  color: ${colors.subtext};
  font-size: 13px;
`;

export const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

export const Panel = styled.section`
  background: ${colors.background};
  border: 1px solid ${colors.borderDark};
  border-radius: 3px;
  padding: 16px;
`;

export const PanelTitle = styled.h2`
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: ${colors.dfgreen};
`;

export const Toolbar = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
`;

export const ModeButton = styled.button<{ $on: boolean }>`
  font-family: inherit;
  font-size: 13px;
  background: ${(props) => (props.$on ? colors.dfgreen : colors.page)};
  color: ${(props) => (props.$on ? colors.page : colors.dfgreen)};
  border: 1px solid ${colors.dfgreen};
  border-radius: 3px;
  padding: 6px 12px;
  cursor: pointer;

  &:hover {
    background: ${colors.dfgreen};
    color: ${colors.page};
  }
`;

export const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 8px;
  color: ${colors.subtext};
  font-size: 13px;
`;

export const Swatch = styled.i<{ $color: string }>`
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 99px;
  background: ${(props) => props.$color};
`;

export const Empty = styled.p`
  margin: 8px 0 0;
  color: ${colors.subtext};
`;

export const Hint = styled.pre`
  margin: 16px 0 0;
  padding: 12px 14px;
  overflow-x: auto;
  background: ${colors.page};
  border: 1px solid ${colors.borderDark};
  border-radius: 3px;
  color: ${colors.text};
  font-family: "Fira Sans", system-ui, sans-serif;
  font-size: 14px;
`;

export const ChartSvg = styled.svg`
  width: 100%;
  height: auto;
  display: block;
`;

export const Tip = styled.div`
  position: fixed;
  z-index: 2;
  pointer-events: none;
  max-width: 280px;
  padding: 8px 10px;
  background: ${colors.background};
  border: 1px solid ${colors.border};
  border-radius: 3px;
  color: ${colors.text};
  font-size: 13px;
  font-variant-numeric: tabular-nums;
`;

export const RankList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const RankRow = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 180px) 1fr auto;
  gap: 10px;
  align-items: center;
`;

export const RankLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${colors.text};
  font-size: 13px;
`;

export const RankTrack = styled.div`
  height: 8px;
  background: ${colors.page};
  border-radius: 3px;
`;

export const RankFill = styled.div<{ $color: string }>`
  height: 100%;
  border-radius: 3px;
  background: ${(props) => props.$color};
`;

export const RankValue = styled.span`
  color: ${colors.dfwhite};
  font-size: 13px;
  font-variant-numeric: tabular-nums;
`;

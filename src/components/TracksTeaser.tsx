import { HistoryTrackMap } from "./HistoryTrackMap";

/**
 * 首页的轨迹预览：地图直接摊在看板上，不用先点开抽屉/页面。
 * 完整能力（区间、回放、对比）在独立的轨迹页里。
 */
export function TracksTeaser({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="tracks-teaser" aria-label="轨迹">
      <header className="tracks-teaser-head">
        <div>
          <h2>轨迹</h2>
          <p>今天走过的路，直接看；要回放或换时间段，进轨迹页。</p>
        </div>
        <button type="button" className="tracks-teaser-open" onClick={onOpen}>
          打开轨迹页 ↗
        </button>
      </header>
      <div className="tracks-teaser-map">
        <HistoryTrackMap embedded />
      </div>
    </section>
  );
}

export default TracksTeaser;

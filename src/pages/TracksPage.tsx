import { useEffect } from "react";
import { HistoryTrackMap } from "../components/HistoryTrackMap";

/**
 * 独立轨迹页：整屏覆盖，地图和时间轴都是一等公民。
 * 现在先用 embedded 版把「从抽屉里搬出来」这一步坐实，后续再做对比/日历/导出。
 */
export function TracksPage({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="tracks-page" role="dialog" aria-label="轨迹">
      <header className="tracks-head">
        <button type="button" className="tracks-back" onClick={onClose} aria-label="返回看板">
          ‹ 看板
        </button>
        <div className="tracks-title">
          <h1>轨迹</h1>
          <p>选一段时间，看车是怎么走的；点某一趟可以只看这一趟。</p>
        </div>
        <button type="button" className="tracks-close" onClick={onClose} aria-label="关闭轨迹页">
          ✕
        </button>
      </header>
      <div className="tracks-body">
        <HistoryTrackMap embedded />
      </div>
    </div>
  );
}

export default TracksPage;

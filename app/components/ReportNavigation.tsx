"use client";

import { groupAvailableReports, type NavigationReport } from "../data/reportGuide";

type Props = {
  reports: readonly NavigationReport[];
  selectedReport: string;
  onSelect: (reportId: string) => void;
};

export default function ReportNavigation({ reports, selectedReport, onSelect }: Props) {
  const areas = groupAvailableReports(reports);
  const activeArea = areas.find(area => area.reports.some(report => report.id === selectedReport)) ?? areas[0];
  const selectReport = (id: string) => {
    if (reports.some(report => report.id === id)) onSelect(id);
  };
  const selectArea = (id: string) => {
    const area = areas.find(item => item.id === id);
    if (area && area.id !== activeArea?.id) selectReport(area.reports[0].id);
    else if (area && !area.reports.some(report => report.id === selectedReport)) selectReport(area.reports[0].id);
  };

  if (!activeArea) return <section className="report-navigation no-print" aria-label="Reportes">
    <p className="report-navigation-empty">No tenés reportes habilitados. Solicitá a Administración la revisión de tus permisos.</p>
  </section>;

  return <section className="report-navigation no-print" aria-label="Reportes por área">
    <div className="report-navigation-heading">
      <h2>Reportes por área</h2>
      <span>{reports.length} {reports.length === 1 ? "informe disponible" : "informes disponibles"}</span>
    </div>
    <label className="report-area-mobile">
      Área
      <select value={activeArea.id} onChange={event => selectArea(event.target.value)}>
        {areas.map(area => <option key={area.id} value={area.id}>{area.title} ({area.reports.length})</option>)}
      </select>
    </label>
    <nav className="report-areas" aria-label="Áreas de reportes">
      {areas.map(area => <button key={area.id} type="button"
        aria-pressed={area.id === activeArea.id} aria-controls="report-area-options"
        onClick={() => selectArea(area.id)} className="report-area-button">
        <span>{area.title}</span><span className="report-area-count" aria-hidden="true">{area.reports.length}</span>
      </button>)}
    </nav>
    <nav id="report-area-options" aria-label={`Informes de ${activeArea.title}`} className="report-options">
      {activeArea.reports.map(report => <button key={report.id} type="button"
        onClick={() => selectReport(report.id)} title={report.detail}
        aria-current={report.id === selectedReport ? "page" : undefined}
        aria-describedby={`report-description-${report.id}`} className="report-option">
        <span className="report-option-title">{report.title}
          {report.id === selectedReport && <span className="report-current-mark" aria-hidden="true">✓</span>}
        </span>
        <span id={`report-description-${report.id}`} className="report-option-description">{report.summary}</span>
        {report.status === "Pendiente" && <span className="report-option-status">En desarrollo</span>}
      </button>)}
    </nav>
  </section>;
}

import Heading from "../shared/components/Heading";
import styles from "./ComingSoonPanel.module.css";

export type ComingSoonSection = "Recetas y costos" | "Legajos" | "MRP";

const CONTENT: Record<ComingSoonSection, { eyebrow: string; title: string; description: string; body: string; cards?: string[] }> = {
  "Recetas y costos": {
    eyebrow: "ADMINISTRACIÓN · PRODUCCIÓN",
    title: "Recetas y costos",
    description: "Módulo reservado para fichas técnicas, rendimiento, insumos y costo por producto.",
    body: "Esta sección quedará preparada para cargar recetas, materias primas, unidades, merma, rendimiento, costo teórico y margen de cada producto. Se trabajará al finalizar los módulos operativos de ventas, caja, stock y reportes.",
    cards: ["Fichas técnicas y rendimientos", "Costo de insumos y variación", "Margen por producto y categoría"],
  },
  Legajos: {
    eyebrow: "ADMINISTRACIÓN · PERSONAL",
    title: "Legajos",
    description: "Módulo reservado para la documentación y el historial laboral del equipo.",
    body: "Aquí se concentrarán los datos del empleado, documentación, altas y bajas, puesto, local asignado, horarios, observaciones y vencimientos. El acceso quedará limitado a Administración.",
    cards: ["Datos y documentación", "Historial y observaciones", "Vencimientos y alertas"],
  },
  MRP: {
    eyebrow: "ADMINISTRACIÓN · PRODUCCIÓN",
    title: "MRP",
    description: "Planificación de requerimientos de materiales para producción y abastecimiento.",
    body: "Este módulo se utilizará más adelante para planificar qué materias primas comprar o producir según las recetas, el stock disponible, los pedidos de los locales y la proyección de ventas.",
  },
};

export default function ComingSoonPanel({ section }: { section: ComingSoonSection }) {
  const content = CONTENT[section];
  return (
    <>
      <Heading k={content.eyebrow} h={content.title} p={content.description} />
      <div className={styles.notice}>
        <p className="font-bold">Próximamente</p>
        <p className={styles.noticeBody}>{content.body}</p>
      </div>
      {content.cards && (
        <div className={styles.grid}>
          {content.cards.map((item) => <div key={item} className={styles.card}><p className="font-bold">{item}</p><p className={styles.muted}>Pendiente de configuración.</p></div>)}
        </div>
      )}
    </>
  );
}

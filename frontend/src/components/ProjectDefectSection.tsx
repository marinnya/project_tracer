import { useState } from "react";

// Типы дефекта
type DefectType = {
  id: number;
  name: string;
};

// Тип одного дефекта
type Defect = {
  id: number;
  typeId: number | "";
  typeName: string;
  pages: number | "";
  files: File[];
};

// Пропсы — состояние живёт в ProjectPage, сюда передаётся сверху
type Props = {
  title: string;
  defects: Defect[];
  onDefectsChange: (defects: Defect[]) => void;
};

const defectTypes: DefectType[] = [
  { id: 1, name: "Тип 1" },
  { id: 2, name: "Тип 2" },
  { id: 3, name: "Тип 3" },
  { id: 4, name: "Коррозия" },
  { id: 5, name: "Трещина" },
];

const pageOptions = Array.from({ length: 11 }, (_, i) => i);

function ProjectDefectSection({ title, defects, onDefectsChange }: Props) {

  // обновление одного поля конкретного дефекта
  const updateDefect = (id: number, patch: Partial<Omit<Defect, "id">>) => {
    onDefectsChange(
      defects.map(d => d.id === id ? { ...d, ...patch } : d)
    );
  };

  // добавление нового дефекта (только если последний заполнен)
  const addDefect = () => {
    const last = defects[defects.length - 1];
    if (!last.typeId || !last.pages) {
      alert("Заполните тип дефекта и количество страниц");
      return;
    }
    onDefectsChange([
      ...defects,
      { id: Date.now(), typeId: "", typeName: "", pages: "", files: [] }
    ]);
  };

  // удаление дефекта (минимум 1 остаётся)
  const removeDefect = (id: number) => {
    if (defects.length === 1) return;
    onDefectsChange(defects.filter(d => d.id !== id));
  };

  return (
    <div className="project-section">
      <h3>{title}</h3>

      {defects.map((defect, index) => (
        <div key={defect.id} className="windows defect-card">

          <div className="defect-header">
            <span>№{index + 1}</span>
            {defects.length > 1 && (
              <button className="delete-btn" onClick={() => removeDefect(defect.id)}>
                ✕
              </button>
            )}
          </div>

          {/* Тип дефекта */}
          <div className="section-row-defect">
            <label>Тип дефекта*</label>
            <select
              value={defect.typeId}
              onChange={(e) => {
                const selected = defectTypes.find(d => d.id === Number(e.target.value));
                updateDefect(defect.id, {
                  typeId: Number(e.target.value) || "",
                  typeName: selected?.name ?? "",
                });
              }}
            >
              <option value="">Выберите тип дефекта</option>
              {defectTypes.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Количество страниц */}
          <div className="section-row">
            <label>Количество страниц*</label>
            <select
              value={defect.pages}
              onChange={(e) =>
                updateDefect(defect.id, { pages: Number(e.target.value) || "" })
              }
            >
              {/*<option value="">-</option>*/}
              {pageOptions.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {/* Загрузка файлов */}
          <input
            id={`defect-upload-${defect.id}`}
            type="file"
            multiple
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              if (!e.target.files) return;
              updateDefect(defect.id, { files: Array.from(e.target.files) });
            }}
          />
          <label htmlFor={`defect-upload-${defect.id}`} className="file-row-defect">
            <img src="/clip.png" alt="attach" />
            <span>
              Выберите файлы (до 10 Мб)
              {defect.files.length > 0 && ` — выбрано: ${defect.files.length}`}
            </span>
          </label>

        </div>
      ))}

      <button className="add-defect-btn" onClick={addDefect}>
        <img src="/add_circle.png" alt="" />
        Добавить дефект
      </button>
    </div>
  );
}

export default ProjectDefectSection;
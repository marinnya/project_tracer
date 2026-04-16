import { useState, useMemo } from "react";

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

type SavedPhoto = {
  id: number;
  section: string;
  defectType?: string;
  originalName: string;
  order: number;
};

type Props = {
  title: string;
  defects: Defect[];
  savedPhotos: SavedPhoto[];
  onDefectsChange: (defects: Defect[]) => void;
  onRemoveSaved: (id: number) => void;
};

const defectTypes: DefectType[] = [
  { id: 1, name: "Тип 1" },
  { id: 2, name: "Тип 2" },
  { id: 3, name: "Тип 3" },
  { id: 4, name: "Коррозия" },
  { id: 5, name: "Трещина" },
];

const pageOptions = Array.from({ length: 11 }, (_, i) => i);

function ProjectDefectSection({
  title,
  defects,
  savedPhotos,
  onDefectsChange,
  onRemoveSaved,
}: Props) {
  const [expandedMap, setExpandedMap] = useState<Record<number, boolean>>({});

  const updateDefect = (id: number, patch: Partial<Omit<Defect, "id">>) => {
    onDefectsChange(defects.map(d => (d.id === id ? { ...d, ...patch } : d)));
  };

  const addDefect = () => {
    const last = defects[defects.length - 1];
    if (!last.typeId || !last.pages) {
      alert("Заполните тип дефекта и количество страниц");
      return;
    }

    onDefectsChange([
      ...defects,
      { id: Date.now(), typeId: "", typeName: "", pages: "", files: [] },
    ]);
  };

  const removeDefect = (id: number) => {
    if (defects.length === 1) return;
    onDefectsChange(defects.filter(d => d.id !== id));
  };

  const handleAddFiles = (defect: Defect, newFiles: FileList) => {
    const existing = [
      ...savedPhotos
        .filter(p => p.section === "дефекты" && p.defectType === defect.typeName)
        .map(p => p.originalName),
      ...defect.files.map(f => f.name),
    ];

    const result: File[] = [...defect.files];

    Array.from(newFiles).forEach(file => {
      let name = file.name;
      const ext = name.includes(".") ? "." + name.split(".").pop() : "";
      const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;

      if (existing.includes(name)) {
        let counter = 1;
        while (existing.includes(`${base} (${counter})${ext}`)) {
          counter++;
        }
        name = `${base} (${counter})${ext}`;
      }

      existing.push(name);
      result.push(new File([file], name, { type: file.type }));
    });

    updateDefect(defect.id, { files: result });
  };

  return (
    <div className="project-section">
      <h3>{title}</h3>

      {defects.map((defect, index) => {
        const allFiles = useMemo(() => {
          const saved = savedPhotos
            .filter(
              p => p.section === "дефекты" && p.defectType === defect.typeName
            )
            .sort((a, b) => a.order - b.order)
            .map(p => ({
              id: p.id,
              name: p.originalName,
              isSaved: true as const,
            }));

          const newFiles = defect.files.map(f => ({
            id: undefined,
            name: f.name,
            isSaved: false as const,
          }));

          return [...saved, ...newFiles];
        }, [savedPhotos, defect]);

        const removeNewFile = (name: string) => {
          updateDefect(defect.id, {
            files: defect.files.filter(f => f.name !== name),
          });
        };

        return (
          <div key={defect.id} className="windows defect-card">
            <div className="defect-header">
              <span>№{index + 1}</span>
              {defects.length > 1 && (
                <button
                  className="delete-btn"
                  onClick={() => removeDefect(defect.id)}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Тип дефекта */}
            <div className="section-row-defect">
              <label>Тип дефекта*</label>
              <select
                value={defect.typeId}
                onChange={e => {
                  const selected = defectTypes.find(
                    d => d.id === Number(e.target.value)
                  );
                  updateDefect(defect.id, {
                    typeId: Number(e.target.value) || "",
                    typeName: selected?.name ?? "",
                  });
                }}
              >
                <option value="">Выберите тип дефекта</option>
                {defectTypes.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Страницы */}
            <div className="section-row">
              <label>Количество страниц*</label>
              <select
                value={defect.pages}
                onChange={e =>
                  updateDefect(defect.id, {
                    pages: Number(e.target.value) || "",
                  })
                }
              >
                {pageOptions.map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            {/* Upload */}
            <input
              id={`defect-upload-${defect.id}`}
              type="file"
              multiple
              accept="image/*"
              style={{ display: "none" }}
              onChange={e => {
                if (!e.target.files) return;
                handleAddFiles(defect, e.target.files);
                e.target.value = "";
              }}
            />

            <label
              htmlFor={`defect-upload-${defect.id}`}
              className="file-row-defect"
            >
              <img src="/clip.png" alt="attach" />
              <span>
                Выберите файлы (до 10 Мб)
                {allFiles.length > 0 && ` — всего: ${allFiles.length}`}
              </span>
            </label>

            {/* FILE LIST */}
            {allFiles.length > 0 && (
              <ul className="file-list">
                {expandedMap[defect.id] &&
                  allFiles.map((item, i) => (
                    <li key={`${item.name}-${i}`} className="file-item">
                      <span className="file-name">{item.name}</span>
                      <button
                        className="file-remove"
                        onClick={() => {
                          if (item.isSaved) {
                            onRemoveSaved(item.id!);
                          } else {
                            removeNewFile(item.name);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}

                <button
                  className="file-list-toggle"
                  onClick={() =>
                    setExpandedMap(prev => ({
                      ...prev,
                      [defect.id]: !prev[defect.id],
                    }))
                  }
                >
                  {expandedMap[defect.id]
                    ? "Свернуть"
                    : `Показать все (${allFiles.length})`}
                </button>
              </ul>
            )}
          </div>
        );
      })}

      <button className="add-defect-btn" onClick={addDefect}>
        <img src="/add_circle.png" alt="" />
        Добавить дефект
      </button>
    </div>
  );
}

export default ProjectDefectSection;
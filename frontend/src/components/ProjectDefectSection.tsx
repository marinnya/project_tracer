import { useState } from "react";

type DefectType = {
  id: number;
  name: string;
};

type Defect = {
  id: number;
  typeId: number | "";
  typeName: string;
  pages: number | "";
  files: File[];
};

type SavedPhoto = {
  id: number;
  originalName: string;
  order: number;
  yandexPath: string | null;
};

type SavedDefect = {
  id: number;
  typeId: number;
  typeName: string;
  pages: number;
  photos: SavedPhoto[];
};

type Props = {
  title: string;
  defects: Defect[];
  savedDefects: SavedDefect[];
  onDefectsChange: (defects: Defect[]) => void;
  onRemoveSavedPhoto: (id: number) => void;
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
  savedDefects,
  onDefectsChange,
  onRemoveSavedPhoto,
}: Props) {
  const [expandedMap, setExpandedMap] = useState<Record<number, boolean>>({});

  const updateDefect = (id: number, patch: Partial<Omit<Defect, "id">>) => {
    onDefectsChange(defects.map(d => (d.id === id ? { ...d, ...patch } : d)));
  };

  const addDefect = () => {
    const last = defects[defects.length - 1];
    if (!last?.typeId || !last?.pages) {
      alert("Заполните тип дефекта и количество страниц");
      return;
    }
    onDefectsChange([
      ...defects,
      { id: -Date.now(), typeId: "", typeName: "", pages: "", files: [] },
    ]);
  };

  const removeDefect = (id: number) => {
    if (defects.length === 1) return;
    onDefectsChange(defects.filter(d => d.id !== id));
  };

  const handleAddFiles = (defect: Defect, newFiles: FileList) => {
    const savedDef = savedDefects.find(sd => sd.id === defect.id);
    const existing = [
      ...(savedDef?.photos.map(p => p.originalName) ?? []),
      ...defect.files.map(f => f.name),
    ];

    const result: File[] = [...defect.files];

    Array.from(newFiles).forEach(file => {
      let name = file.name;
      const ext = name.includes(".") ? "." + name.split(".").pop() : "";
      const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;

      if (existing.includes(name)) {
        let counter = 1;
        while (existing.includes(`${base} (${counter})${ext}`)) counter++;
        name = `${base} (${counter})${ext}`;
      }

      existing.push(name);
      result.push(new File([file], name, { type: file.type }));
    });

    updateDefect(defect.id, { files: result });
  };

  const removeNewFile = (defectId: number, fileName: string) => {
    const defect = defects.find(d => d.id === defectId);
    if (!defect) return;
    updateDefect(defectId, { files: defect.files.filter(f => f.name !== fileName) });
  };

  return (
    <div className="project-section">
      <h3>{title}</h3>

      {defects.map((defect, index) => {
        const savedDef = savedDefects.find(sd => sd.id === defect.id);
        const savedPhotos = savedDef?.photos ?? [];

        const allFiles = [
          ...savedPhotos.map(p => ({
            id: p.id,
            name: p.originalName,
            isSaved: true as const,
            onYandex: !!p.yandexPath,
          })),
          ...defect.files.map(f => ({
            id: undefined as number | undefined,
            name: f.name,
            isSaved: false as const,
            onYandex: false,
          })),
        ];

        const isExpanded = expandedMap[defect.id] ?? false;

        return (
          <div key={defect.id} className="defect-card">
            <div className="defect-row">
              <div className="defect-number-row">
                <span className="defect-number">№{index + 1}</span>
                {defects.length > 1 && (
                  <button className="delete-btn mobile-only" onClick={() => removeDefect(defect.id)}>✕</button>
                )}
              </div>

              <div className="defect-fields">
                <div className="section-row-defect">
                  <label>Тип дефекта*</label>
                  <select
                    value={defect.typeId}
                    onChange={e => {
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

                <div className="section-row-defect">
                  <label>Количество страниц*</label>
                  <select
                    value={defect.pages}
                    onChange={e => updateDefect(defect.id, { pages: Number(e.target.value) || "" })}
                  >
                    {pageOptions.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

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

                <label htmlFor={`defect-upload-${defect.id}`} className="file-row-defect">
                  <img src="/clip.png" alt="attach" />
                  <span>Выберите файлы (до 10 Мб)</span>
                </label>
              </div>

              {defects.length > 1 && (
                <button className="delete-btn desktop-only" onClick={() => removeDefect(defect.id)}>✕</button>
              )}
            </div>

            {allFiles.length > 0 && (
              <ul className="file-list">
                {isExpanded && (
                  <>
                    <p className="file-list-label">Добавленные файлы</p>
                    {allFiles.map((item, i) => (
                      <li key={`${item.name}-${i}`} className="file-item">
                        <span className="file-name">{item.name}</span>
                        {!item.onYandex && (
                          <button
                            className="file-remove"
                            onClick={() => {
                              if (item.isSaved) {
                                onRemoveSavedPhoto(item.id!);
                              } else {
                                removeNewFile(defect.id, item.name);
                              }
                            }}
                            title="Удалить файл"
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                  </>
                )}

                <button
                  className="file-list-toggle"
                  onClick={() => setExpandedMap(prev => ({ ...prev, [defect.id]: !prev[defect.id] }))}
                >
                  {isExpanded ? "Свернуть" : `Показать все (${allFiles.length})`}
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
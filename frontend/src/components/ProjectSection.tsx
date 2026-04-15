import { useRef, useState } from "react";

type SavedPhoto = {
  id: number;
  originalName: string;
};

type Props = {
  title: string;
  files: File[];
  pages: number;
  savedPhotos: SavedPhoto[];
  onFilesChange: (files: File[]) => void;
  onPagesChange: (pages: number) => void;
  onRemoveSaved: (id: number) => void;
};

const pageOptions = Array.from({ length: 11 }, (_, i) => i);

function ProjectSection({
  title,
  files,
  pages,
  savedPhotos,
  onFilesChange,
  onPagesChange,
  onRemoveSaved,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);

  const allFiles = [
    ...savedPhotos.map(p => ({
      id: p.id,
      name: p.originalName,
      isSaved: true as const,
    })),
    ...files.map(f => ({
      name: f.name,
      isSaved: false as const,
    })),
  ];

  const visibleFiles = expanded ? allFiles : allFiles.slice(0, 3);

  const removeNewFile = (name: string) => {
    onFilesChange(files.filter(f => f.name !== name));
  };

  return (
    <div className="project-section">
      <h3>{title}</h3>

      <div className="section-row">
        <label>Количество страниц*</label>
        <select
          value={pages}
          onChange={(e) => onPagesChange(Number(e.target.value))}
        >
          {pageOptions.map(n => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (!e.target.files) return;
          onFilesChange([...files, ...Array.from(e.target.files)]);
          e.target.value = "";
        }}
      />

      <div className="file-row" onClick={() => inputRef.current?.click()}>
        <img src="/clip.png" alt="attach" />
        <span>Выберите файлы</span>
      </div>

      {allFiles.length > 0 && (
        <ul className="file-list">
          {visibleFiles.map((item) => (
            <li
              key={item.isSaved ? item.id : item.name}
              className="file-item"
            >
              <span className="file-name">{item.name}</span>

              <button
                className="file-remove"
                onClick={() => {
                  if (item.isSaved) {
                    onRemoveSaved(item.id);
                  } else {
                    removeNewFile(item.name);
                  }
                }}
                title="Удалить файл"
              >
                ✕
              </button>
            </li>
          ))}

          {allFiles.length > 3 && (
            <button
              className="file-list-toggle"
              onClick={() => setExpanded(p => !p)}
            >
              {expanded ? "Свернуть" : `Показать все (${allFiles.length})`}
            </button>
          )}
        </ul>
      )}
    </div>
  );
}

export default ProjectSection;
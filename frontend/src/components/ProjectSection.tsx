import { useRef, useState, useMemo } from "react";

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

  const handleAddFiles = (newFiles: FileList) => {
    const existing = [
      ...savedPhotos.map(p => p.originalName),
      ...files.map(f => f.name),
    ];

    const result: File[] = [...files];

    Array.from(newFiles).forEach(file => {
      let name = file.name;
      const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
      const base = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;

      // если имя уже занято — добавляем (1), (2) и т.д.
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

    onFilesChange(result);
  };

  // объединяем сохранённые и новые файлы для отображения
  const allFiles = useMemo(() => [
    ...savedPhotos.map(p => ({
      id: p.id,
      name: p.originalName,
      isSaved: true as const,
    })),
    ...files.map(f => ({
      id: undefined,
      name: f.name,
      isSaved: false as const,
    })),
  ], [savedPhotos, files]);

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
            <option key={n} value={n}>{n}</option>
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
          handleAddFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="file-row" onClick={() => inputRef.current?.click()}>
        <img src="/clip.png" alt="attach" />
        <span className="desktop-only">Выберите файлы (максимальный размер до 10 Мб)</span>
        <span className="mobile-only">Выберите файлы (до 10 Мб)</span>
      </div>

      {/* список файлов — скрыт по умолчанию */}
      {allFiles.length > 0 && (
        <ul className="file-list">
          {expanded && allFiles.map((item, index) => (
            <li key={`${item.name}-${index}`} className="file-item">
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
                title="Удалить файл"
              >
                ✕
              </button>
            </li>
          ))}

          <button
            className="file-list-toggle"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? "Свернуть" : `Показать все (${allFiles.length})`}
          </button>
        </ul>
      )}
    </div>
  );
}

export default ProjectSection;
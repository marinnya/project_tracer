import { useRef, useState } from "react";

type Props = {
  title: string;
  files: File[];
  pages: number;
  savedFileNames: string[]; // оригинальные имена ранее сохранённых файлов из БД
  onFilesChange: (files: File[]) => void;
  onPagesChange: (pages: number) => void;
};

const pageOptions = Array.from({ length: 11 }, (_, i) => i);

function ProjectSection({ title, files, pages, savedFileNames, onFilesChange, onPagesChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);

  const visibleFiles = expanded ? files : [];

  const removeFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
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

      {/* показываем ранее сохранённые файлы из БД */}
      {savedFileNames.length > 0 && files.length === 0 && (
        <div className="saved-files">
          <p className="saved-files-label">Ранее загруженные файлы:</p>
          <ul className="file-list">
            {savedFileNames.map((name, index) => (
              <li key={`saved-${index}`} className="file-item saved">
                <span className="file-name">{name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <span className="desktop-only">Выберите файлы (максимальный размер до 10 Мб)</span>
        <span className="mobile-only">Выберите файлы (до 10 Мб)</span>
      </div>

      {files.length > 0 && (
        <ul className="file-list">
          {visibleFiles.map((file, index) => (
            <li key={`${file.name}-${index}`} className="file-item">
              <span className="file-name">{file.name}</span>
              <button
                className="file-remove"
                onClick={() => removeFile(index)}
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
            {expanded ? "Свернуть" : `Показать все (${files.length})`}
          </button>
        </ul>
      )}
    </div>
  );
}

export default ProjectSection;
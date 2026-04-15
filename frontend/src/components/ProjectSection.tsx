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

  // объединяем новые файлы и сохранённые имена для отображения
  // новые файлы показываем первыми, потом сохранённые которые не были заменены
  const allFileNames = [
    ...files.map(f => ({ name: f.name, isSaved: false, index: files.indexOf(f) })),
    ...savedFileNames
      .filter(name => !files.some(f => f.name === name)) // не показываем если уже есть среди новых
      .map(name => ({ name, isSaved: true, index: -1 })),
  ];

  const visibleFiles = expanded ? allFileNames : [];
  const totalCount = allFileNames.length;

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

      {totalCount > 0 && (
        <ul className="file-list">
          {visibleFiles.map((item, index) => (
            <li key={`${item.name}-${index}`} className="file-item">
              <span className="file-name">{item.name}</span>
              {/* кнопка удаления только для новых файлов, сохранённые не удаляем */}
              {!item.isSaved && (
                <button
                  className="file-remove"
                  onClick={() => removeFile(item.index)}
                  title="Удалить файл"
                >
                  ✕
                </button>
              )}
            </li>
          ))}

          <button
            className="file-list-toggle"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded ? "Свернуть" : `Показать все (${totalCount})`}
          </button>
        </ul>
      )}
    </div>
  );
}

export default ProjectSection;
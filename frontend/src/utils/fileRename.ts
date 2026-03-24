// utils/fileRename.ts

// Маппинг названий секций на короткие кириллические префиксы для имён файлов
const sectionKeyMap: Record<string, string> = {
  "Титульный лист": "титульный",
  "Технические данные объекта контроля": "техданные",
  "План-схема склада": "план",
  "Лист для фиксации повреждений": "повреждения",
  "Лист для фиксации отклонений в вертикальной плоскости": "отклонения",
  "Лист для фиксации момента затяжки болтовых и анкерных соединений": "болты",
  "Лист для эскизов": "эскизы",
  "Дополнительная информация": "допинфо",
};

// Переименование файлов обычных секций: "титульный1.jpg", "план2.jpg" и т.д.
export function renameSection(files: File[], sectionTitle: string): File[] {
  const prefix = sectionKeyMap[sectionTitle] ?? sectionTitle.toLowerCase();
  return files.map((file, i) => {
    const ext = file.name.split(".").pop() ?? "jpg";
    return new File([file], `${prefix}${i + 1}.${ext}`, { type: file.type });
  });
}

// Переименование файлов дефектов: "коррозия1.jpg", "трещина2.jpg" и т.д.
export function renameDefect(files: File[], defectTypeName: string): File[] {
  const prefix = defectTypeName.toLowerCase();
  return files.map((file, i) => {
    const ext = file.name.split(".").pop() ?? "jpg";
    return new File([file], `${prefix}${i + 1}.${ext}`, { type: file.type });
  });
}
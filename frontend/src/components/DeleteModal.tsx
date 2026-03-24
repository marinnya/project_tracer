import "../styles/successModal.css";
import type { Employee } from "../types/Employee";

// Типы для пропсов
type Props = {
  employee: Employee; // объект сотрудника
  onClose: () => void; // функция без арг., которая вызывается при закрытии модального окна
  onDelete: (id: number) => void; // функция принимает id сотрудника для удаления
};

// компонент работает с пропсами: employee, onClose, onBlock
export default function DeleteModal({ employee, onClose, onDelete }: Props) {
  // функция для обработки удаления
  const handleDelete = () => {
    onDelete(employee.id); // вызываем функцию удаления с id сотрудника
    onClose(); // закрываем модалку
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal_block" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <h2>Удаление сотрудника</h2>

        <p className="modal-text">
          Вы уверены, что хотите удалить сотрудника <b>{employee.firstName} {employee.lastName}</b>?
        </p>

        <div className="buttons">
          <button className="btn primary" onClick={handleDelete}>Удалить</button>
          <button className="btn secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

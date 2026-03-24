import "../styles/successModal.css";
import type { Employee } from "../types/Employee";

// Типы для пропсов
type Props = {
  employee: Employee; // объект сотрудника
  onClose: () => void; // функция без арг., которая вызывается при закрытии модального окна
  onBlock: (id: number, block: boolean) => void; // функция принимает id сотрудника и block для блокировки/разблокировки
};

// компонент работает с пропсами: employee, onClose, onBlock
export default function BlockModal({ employee, onClose, onBlock }: Props) {

  // функция для обработки блокировки
  const handleBlock = () => {
    onBlock(employee.id, !employee.isBlocked); // вызываем функцию блокировки с id сотрудника, переключаем текущий статус блокировки
    onClose(); // закрываем модалку
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal_block" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>

        <h2>{employee.isBlocked ? "Разблокировать" : "Блокировать"} сотрудника</h2>

        <p className="modal-text">
          Вы уверены, что хотите {employee.isBlocked ? "разблокировать" : "заблокировать"} сотрудника <b>{employee.firstName} {employee.lastName}</b>?
        </p>

        <div className="buttons">
                <button className="btn primary" onClick={handleBlock}>{employee.isBlocked ? "Разблокировать" : "Заблокировать"}</button>
                <button className="btn secondary" onClick={() => onClose()}>Отмена</button>
            </div>
      </div>
    </div>
  );
}

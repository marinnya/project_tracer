import "../styles/successModal.css";

type Props = {
  onClose: () => void;
};

export default function SuccessModal({ onClose }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <button className="modal-close" onClick={onClose}>×</button>

        <p className="modal-text">
          Данные успешно записаны! Проект помещен в архив.
        </p>

        <button className="modal-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

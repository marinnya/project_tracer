type Props = {
  onClose: () => void;
  message: string;
};

export default function SuccessModal({ onClose, message }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <button className="modal-close" onClick={onClose}>×</button>

        <p className="modal-text">
          {message}
        </p>

        <button className="modal-ok" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
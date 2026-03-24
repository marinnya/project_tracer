import { useState } from "react";

export default function AdminRecoveryForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleRecovery = async () => {
    if (!email) {
      setError("Введите email");
      return;
    }

    try {
      await fetch("http://localhost:3000/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      // показываем успех независимо от результата — не раскрываем существует ли email
      setSent(true);
    } catch {
      setError("Ошибка сервера — попробуйте позже");
    }
  };

  if (sent) {
    return (
      <p>Если указанный email зарегистрирован, на него придёт письмо со ссылкой для восстановления доступа.</p>
    );
  }

  return (
    <>
      <p>Введите почту администратора</p>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(""); }}
      />
      {error && <div className="error">{error}</div>}
      <button className="primary" onClick={handleRecovery}>Восстановить</button>
    </>
  );
}
import AdminRecoveryForm from "./AdminRecoveryForm";
import EmployeeRecoveryForm from "./EmployeeRecoveryForm";

// Роль пользователя
type Role = "employee" | "admin";

// Интерфейс описывает, какие свойства должен получать компонент
interface RecoveryProps {
    role: Role; // роль
    onBack: () => void; // колбэк-функция, которую компонент вызывает для возврата назад
}

// пропсы role и onBack пришли от родителя, внутри компонента используем их напрямую
export default function Recovery({role, onBack}: RecoveryProps) {
    return (
        <>
            <h2>Восстановление доступа</h2>
            {role === "admin" ? (
                <AdminRecoveryForm />
            ) : (
                <EmployeeRecoveryForm />
            )}

            <button className="back" onClick={onBack}>Назад</button>
        </>
    )
}
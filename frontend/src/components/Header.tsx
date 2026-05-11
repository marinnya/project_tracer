import { useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useClickOutside } from "../hooks/useClickOutside";

// Тип пропсов для компонента Header
// ? - необязательные свойства, компонент может получить эти пропсы, а может нет
type HeaderProps = {
  title?: string;
  subtitle?: string;
  onLogout: () => void; // добавлен обязательный пропс для выхода
};

// Компонент Header получает объект пропсов; если пропсы не переданы, берется значение по умолчанию
// Текст не прописывается "жестко" внутри компонента; есть возможность родителю решать, что показывать, а компонент остаётся «универсальным»
function Header({
  title = "Project Tracer",
  subtitle = "Внесение данных о проектах",
  onLogout,
}: HeaderProps) {

  // работы с состоянием с помощью хука useState
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // константа, которой присваивается стрелочная функция
  // (path: string) — параметр функции, "/home"; возвращает true, если текущий путь совпадает с переданным
  // location — объект, который предоставляет браузер; location.pathname содержит текущий путь в адресной строке
  //const isActive = (path: string) => location.pathname === path;

  // стало — считаем вкладку "Проекты" активной если путь / или /projects/...
  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/" || location.pathname.startsWith("/projects/");
    return location.pathname === path;
  };

  const navigate = useNavigate();
  const location = useLocation();

  // Для закрытия меню по клику вне области
  // useRef - хук, который создаёт ссылку на DOM-элемент
  const mobileMenuRef = useRef<HTMLDivElement | null>(null); // тип ссылки: либо ссылка на div, либо null; начальное значение равно null
  const desktopMenuRef = useRef<HTMLDivElement | null>(null);

  // пользовательские хуки, которые реагируют на клики вне указанного элемента
  useClickOutside(mobileMenuRef, () => setMobileMenuOpen(false)); // Аргументы: ref на элемент, который нужно «защищать» и функция, которая выполнится, если клик произошёл вне элемента
  useClickOutside(desktopMenuRef, () => setDesktopMenuOpen(false));

  // Функция для выхода из приложения
  const handleLogout = () => {
    localStorage.clear(); // чистим токен, роль, имя — всё
    onLogout(); // сообщаем App.tsx что нужно сбросить isAuth
    navigate("/login"); // редирект на страницу входа
  };

  // Берем данные пользователя из локального хранилища браузера
  const currentUser = {
    name: localStorage.getItem("firstName") || "Пользователь",
    role: (localStorage.getItem("role") || "employee").toLowerCase() as "admin" | "employee",
  };

  // Инициалы пользователя
  const initials = currentUser.name
    .split(" ") // разделяем имя по пробелам ["Иван", "Иванов"]
    .map((n) => n[0]) // берем первую букву каждого слова
    .join("") // объединяем буквы в строку "ИИ"
    .toUpperCase() // приводим к верхнему регистру
    .slice(0, 2); // берем первые 2 буквы для инициала пользователя


  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="logo">
          <div className="logo-icon"><img src="/tracer.png" /></div>
          <div className="logo-text">
            <div className="logo-title">{title}</div>
            <div className="logo-subtitle">{subtitle}</div>
          </div>
        </Link>

        {/* Десктопное меню приложения */}
        <nav className="menu desktop-only">
          <button className={`tab ${isActive("/") ? "active" : ""}`} onClick={() => navigate("/")}>
            Проекты
          </button>

          {/* Вкладка "Сотрудники" только для админа; проверяем активность пути и ставим соотвествующий класс*/}
          {currentUser.role === "admin" && (
            <button className={`tab ${isActive("/employees") ? "active" : ""}`} onClick={() => navigate("/employees")}>
              Сотрудники
            </button>
          )}
        </nav>

        {/*Блок пользователя; ref позволяет получить прямой доступ к DOM-элементу, на который он установлен, будет ссылкой на этот div*/}
        <div className="user">
          <div className="mobile-only mobile-user-trigger" ref={mobileMenuRef} onClick={() => setMobileMenuOpen((prev) => !prev)}>
              <img src="/arrow_down.png" alt="Меню" className={`arrow ${mobileMenuOpen ? "open" : ""}`}/>
              <div className="avatar mobile-only">{initials}</div>

              {/* Мобильная кнопка "Проекты" */}
              {mobileMenuOpen && (
              <div className="mobile-menu">
                  <button
                    className={`mobile-nav-btn ${isActive("/") ? "active" : ""}`}
                    onClick={() => {
                      navigate("/");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <img src="/projects.png" alt="" className="nav-icon" />
                    Проекты
                  </button>

                  {/* Мобильная кнопка "Сотрудники" для админа*/}
                  {currentUser.role === "admin" && (
                      <button
                        className={`mobile-nav-btn ${isActive("/employees") ? "active" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate("/employees");
                          setMobileMenuOpen(false);
                        }}
                      >
                        <img src="/users.png" alt="" className="nav-icon" />
                        Сотрудники
                      </button>
                  )}

                  {/* Кнопка "Выйти" */}
                  <button
                    className="logout-btn"
                    onClick={() => {
                      handleLogout();
                      setMobileMenuOpen(false);
                    }}
                  >
                    <img src="/exit.png" alt="Выйти" className="logout-icon" />
                    Выйти
                  </button>
              </div>
              )}
          </div>
              
          {/*Десктопное приветствие*/}
          <span className="welcome desktop-only">Добро пожаловать, {currentUser.name}!</span>

          <div className="avatar desktop-only" ref={desktopMenuRef} onClick={() => setDesktopMenuOpen((prev) => !prev)}>{initials}
              {desktopMenuOpen && (
                  <div className="user-menu">
                      <button className="logout-btn" onClick={handleLogout}>
                        <img src="/exit.png" alt="Выйти" className="logout-icon" />
                        Выйти
                      </button>
                  </div>
              )}
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
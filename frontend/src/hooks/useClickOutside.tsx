import { useEffect } from "react";
// пользовательский хук, который реагирует на клики вне указанного элемента

// объявляем функцию useClickOutside, которая принимает два аргумента: ref и handler
// ref - это ссылка на элемент, который нужно "защищать"
// handler - это функция, которая будет вызываться, если клик произошел вне элемента
export function useClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: () => void
) {
  useEffect(() => {
    // создается обработчик клика, он будет вызываться при каждом клике мышкой
    const listener = (event: MouseEvent) => {
      // берем элемент, по которому кликнули
      const target = event.target as Node;
      // проверяем, есть ли вообще DOM-элемент меню и находится ли клик внутри меню (target - это элемент, по которому кликнули)
      if (!ref.current || ref.current.contains(target)) return;
      handler(); // вызываем функцию handler (setMobileMenuOpen(false)), если клик был вне элемента
    };

    // дальше подписываемя на все клики мышкой на странице
    document.addEventListener("mousedown", listener);

    // функция очистки: когда компонент будет уничтожаться, отписываемся от всех кликов мышкой на странице
    return () => {
      document.removeEventListener("mousedown", listener);
    };
  }, [ref, handler]); // рендерится только при изменении ref или handler
}

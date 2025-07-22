import { Path } from "../constant";
import styles from "./new-chat.module.scss";
import { useNavigate } from "react-router-dom";
import { useChatStore } from "../store";
import { BUILTIN_MASK_STORE } from "../masks";

export function NewChat() {
  const chatStore = useChatStore();
  const navigate = useNavigate();

  const startChat = (id: string) => {
    const mask = BUILTIN_MASK_STORE.get(id);
    if (mask) {
      chatStore.newSession(mask);
      navigate(Path.Chat);
    }
  };

  return (
    <div className={styles["lang-select"]}>
      <button
        className={styles["lang-button"]}
        onClick={() => startChat("100000")}
      >
        Tiếng Việt
      </button>
      <button
        className={styles["lang-button"]}
        onClick={() => startChat("100001")}
      >
        中文
      </button>
    </div>
  );
}

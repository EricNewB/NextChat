import { useEffect, useState } from "react";
import { Path, SlotID } from "../constant";
import styles from "./new-chat.module.scss";

import { useNavigate } from "react-router-dom";
import { Mask, useMaskStore } from "../store/mask";
import { useChatStore } from "../store";
import { MaskAvatar } from "./mask";
import { BUILTIN_MASK_STORE } from "../masks";
import clsx from "clsx";

function MaskItem(props: { mask: Mask; onClick?: () => void }) {
  return (
    <div className={styles["mask"]} onClick={props.onClick}>
      <MaskAvatar
        avatar={props.mask.avatar}
        model={props.mask.modelConfig.model}
      />
      <div className={clsx(styles["mask-name"], "one-line")}>
        {props.mask.name}
      </div>
    </div>
  );
}

function useMaskGroup(masks: Mask[]) {
  const [groups, setGroups] = useState<Mask[][]>([]);

  useEffect(() => {
    const computeGroup = () => {
      const appBody = document.getElementById(SlotID.AppBody);
      if (!appBody || masks.length === 0) return;

      const rect = appBody.getBoundingClientRect();
      const maxWidth = rect.width;
      const maxHeight = rect.height * 0.6;
      const maskItemWidth = 120;
      const maskItemHeight = 50;

      const randomMask = () => masks[Math.floor(Math.random() * masks.length)];
      let maskIndex = 0;
      const nextMask = () => masks[maskIndex++ % masks.length];

      const rows = Math.ceil(maxHeight / maskItemHeight);
      const cols = Math.ceil(maxWidth / maskItemWidth);

      const newGroups = new Array(rows)
        .fill(0)
        .map((_, _i) =>
          new Array(cols)
            .fill(0)
            .map((_, j) => (j < 1 || j > cols - 2 ? randomMask() : nextMask())),
        );

      setGroups(newGroups);
    };

    computeGroup();

    window.addEventListener("resize", computeGroup);
    return () => window.removeEventListener("resize", computeGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return groups;
}

export function NewChat() {
  const chatStore = useChatStore();
  const maskStore = useMaskStore();
  const navigate = useNavigate();

  useEffect(() => {
    // 直接使用 Emora mask 创建新聊天
    const emoraMask = BUILTIN_MASK_STORE.get("100000");
    if (emoraMask) {
      chatStore.newSession(emoraMask);
      navigate(Path.Chat);
    } else {
      // 如果找不到 Emora mask，回到主页
      navigate(Path.Home);
    }
  }, [chatStore, navigate]);

  // 返回一个空的加载界面
  return null;
}

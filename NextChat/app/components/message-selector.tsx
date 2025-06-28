"use client";

import { ChatMessage, useChatStore } from "@/app/store";
import Locale from "@/app/locales";
import { useMemo, useRef, useState } from "react";
import { IconButton } from "./button";
import { Message } from "@/app/typing";

import styles from "./message-selector.module.scss";

import LeftIcon from "@/app/icons/left.svg";
import RightIcon from "@/app/icons/arrow.svg";
import CancelIcon from "@/app/icons/cancel.svg";
import ConfirmIcon from "@/app/icons/confirm.svg";
import { showConfirm } from "./ui-lib";

export function MessageSelector(props: {
  messages: ChatMessage[];
  onSelected: (messages: ChatMessage[]) => void;
  onCancel: () => void;
  defaultSelectCount?: number;
}) {
  const { messages, defaultSelectCount } = props;
  const [selection, setSelection] = useState(new Set<string>());
  const latestSelection = useRef(0);
  const chatStore = useChatStore();

  function updateSelection(updater: (selection: Set<string>) => void) {
    const newSelection = new Set(selection);
    updater(newSelection);
    setSelection(newSelection);
  }

  // if there is no selected message, find the last user message
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        return messages[i];
      }
    }
  }, [messages]);

  useMemo(() => {
    if (selection.size > 0 || !lastUserMessage) return;

    if (defaultSelectCount === 0) return;
    const defaultMessages = [];
    let i = messages.findIndex((m) => m.id === lastUserMessage.id);
    for (; i < messages.length && defaultMessages.length < (defaultSelectCount ?? 1); i += 1) {
      const msg = messages[i];
      if (msg.role === "user" || msg.role === "assistant") {
        defaultMessages.push(msg);
      }
    }
    updateSelection(selection => {
      defaultMessages.forEach(m => selection.add(m.id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUserMessage]);

  const onSelect = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey) {
      // range selection
      const [start, end] = [
        Math.min(latestSelection.current, i),
        Math.max(latestSelection.current, i),
      ];
      updateSelection((selection) => {
        for (let i = start; i <= end; i += 1) {
          selection.add(messages[i].id ?? String(i));
        }
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } else {
      const msg = messages[i];
      latestSelection.current = i;
      updateSelection((selection) => {
        selection.has(msg.id) ? selection.delete(msg.id) : selection.add(msg.id);
      });
    }
  };

  function getMessage(id: string) {
    return messages.find((m) => m.id === id);
  }

  const selectedMessages = useMemo(() => {
    const ret: ChatMessage[] = [];
    for (const id of selection) {
      const msg = getMessage(id);
      if (msg) {
        ret.push(msg);
      }
    }
    return ret;
  }, [selection, messages]);

  const messageNodes = messages.map((m, i) => {
    const id = m.id;
    return (
      <div
        className={`${styles["message-item"]} ${
          selection.has(id) ? styles["selected"] : ""
        }`}
        key={i}
        onClick={(e) => onSelect(e, i)}
      >
        <div className={styles["avatar"]}>{m.role === "user" ? "U" : "A"}</div>
        <div className={styles["body"]}>
          <div className={styles["date"]}>{m.date.toLocaleString()}</div>
          <div className={styles["content"]}>{m.content}</div>
        </div>
      </div>
    );
  });

  return (
    <div className={styles["message-selector-mask"]}>
      <div className={styles["message-selector"]}>
        <div className={styles["title"]}>
          <div>{Locale.MessageSelector.Title}</div>
          <div className={styles["sub-title"]}>
            {Locale.MessageSelector.SubTitle(selectedMessages.length)}
          </div>
        </div>
        <div className={styles["body"]}>{messageNodes}</div>
        <div className={styles["actions"]}>
          <IconButton
            icon={<CancelIcon />}
            text={Locale.UI.Cancel}
            onClick={props.onCancel}
          ></IconButton>
          <IconButton
            icon={<ConfirmIcon />}
            text={Locale.UI.Confirm}
            type="primary"
            onClick={() => {
              if (selectedMessages.length === 0) {
                return showConfirm(Locale.MessageSelector.Confirm);
              }
              props.onSelected(selectedMessages);
            }}
          ></IconButton>
        </div>
      </div>
    </div>
  );
}
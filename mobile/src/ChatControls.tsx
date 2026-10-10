import { useState } from "react";
import { Alert, Button, Text, TextInput, View } from "react-native";
import { client } from "./client";
import {
  useWorkspace,
  styles,
  type Message,
  type Conversation,
} from "./Workspace";
export interface Member {
  userId: string;
  role: string;
  epoch: number;
}
export default function ChatControls({
  conversation,
  members,
  message,
  onRefresh,
  onClose,
}: {
  conversation: Conversation;
  members: Member[];
  message: Message | null;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const w = useWorkspace();
  const [edit, setEdit] = useState(message?.body ?? "");
  const [remind, setRemind] = useState("");
  const mine = members.find((m) => m.userId === w.session?.user.id);
  const readOnly =
    w.work?.me.role === "viewer" ||
    mine?.role === "viewer" ||
    conversation.archived;
  const manage =
    w.work?.me.role !== "viewer" &&
    ["owner", "moderator"].includes(mine?.role ?? "");
  const [role, setRole] = useState("member");
  const root = `/companies/${w.company}/conversations/${conversation.id}`;
  async function act(path: string, body: unknown, method = "POST") {
    try {
      await client.request(path, method, body);
      await onRefresh();
      onClose();
    } catch (e) {
      w.setError((e as Error).message);
    }
  }
  return (
    <View style={styles.message}>
      {message ? (
        <>
          <Text>Selected revision {message.revision}</Text>
          {message.senderId === w.session?.user.id && !readOnly && (
            <>
              <TextInput
                accessibilityLabel="Edit selected message"
                multiline
                style={styles.input}
                value={edit}
                onChangeText={setEdit}
              />
              <Button
                title="Save edited revision"
                onPress={() =>
                  void act(
                    root + "/messages/" + message.id,
                    { expectedRevision: message.revision, body: edit },
                    "PATCH",
                  )
                }
              />
              <Button
                title="Remove selected message"
                onPress={() =>
                  Alert.alert(
                    "Remove message?",
                    "This removes the message for conversation participants.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () =>
                          void act(
                            root + "/messages/" + message.id,
                            {
                              expectedRevision: message.revision,
                              removed: true,
                            },
                            "PATCH",
                          ),
                      },
                    ],
                  )
                }
              />
            </>
          )}
          <Button
            disabled={readOnly}
            title="React 👍"
            onPress={() =>
              void act(root + "/messages/" + message.id + "/reactions", {
                emoji: "👍",
                active: true,
              })
            }
          />
          <Button
            disabled={readOnly}
            title="Remove my 👍 reaction"
            onPress={() =>
              void act(root + "/messages/" + message.id + "/reactions", {
                emoji: "👍",
                active: false,
              })
            }
          />
          {manage && (
            <Button
              disabled={readOnly}
              title="Pin selected message"
              onPress={() =>
                void act(root + "/messages/" + message.id + "/pin", {
                  expectedRevision: message.revision,
                  pinned: true,
                })
              }
            />
          )}
          <TextInput
            accessibilityLabel="Private reminder with offset"
            style={styles.input}
            placeholder="Remind at e.g. 2026-10-12T16:00:00+05:30"
            value={remind}
            onChangeText={setRemind}
          />
          <Button
            title="Save with private reminder"
            disabled={!remind}
            onPress={() =>
              void act(root + "/messages/" + message.id + "/save", {
                saved: true,
                remindAt: remind,
              })
            }
          />
          <Button
            title="Remove private save"
            onPress={() =>
              void act(root + "/messages/" + message.id + "/save", {
                saved: false,
              })
            }
          />
        </>
      ) : (
        <>
          <Text>
            {conversation.kind === "dm"
              ? "Fixed pair direct message"
              : "Private participants start with future messages on join/rejoin"}
          </Text>
          {members.map((m) => (
            <View key={m.userId}>
              <Text>
                {w.work?.people.find((p) => p.id === m.userId)?.name ??
                  "Company member"}{" "}
                · {m.role}
              </Text>
              {manage && conversation.kind !== "dm" && m.role !== "owner" && (
                <>
                  <Button
                    title="Remove participant"
                    onPress={() =>
                      void act(root + "/members", {
                        expectedVersion: conversation.version,
                        userId: m.userId,
                        active: false,
                        role: m.role,
                      })
                    }
                  />
                  {mine?.role === "owner" && (
                    <Button
                      title="Transfer ownership to this participant"
                      onPress={() =>
                        void act(root + "/members", {
                          expectedVersion: conversation.version,
                          userId: m.userId,
                          active: true,
                          role: "owner",
                        })
                      }
                    />
                  )}
                </>
              )}
            </View>
          ))}
          {manage && conversation.kind !== "dm" && (
            <>
              <Text>Add participant role</Text>
              {["member", "viewer", "moderator"].map((r) => (
                <Button
                  key={r}
                  title={r + (role === r ? " ✓" : "")}
                  onPress={() => setRole(r)}
                />
              ))}
              {w.work?.people
                .filter(
                  (p) => p.active && !members.some((m) => m.userId === p.id),
                )
                .map((p) => (
                  <Button
                    key={p.id}
                    title={"Add " + p.name}
                    onPress={() =>
                      void act(root + "/members", {
                        expectedVersion: conversation.version,
                        userId: p.id,
                        active: true,
                        role,
                      })
                    }
                  />
                ))}
            </>
          )}
          {manage && (
            <Button
              title={
                conversation.archived
                  ? "Reopen conversation"
                  : "Archive conversation"
              }
              onPress={() =>
                void act(
                  root,
                  {
                    expectedVersion: conversation.version,
                    archived: !conversation.archived,
                  },
                  "PATCH",
                )
              }
            />
          )}{" "}
          {mine?.role === "owner" && w.work?.me.role !== "viewer" && (
            <Button
              title={
                conversation.forwarding === "deny"
                  ? "Allow explicit selected publication"
                  : "Deny work publication"
              }
              onPress={() =>
                void act(
                  root,
                  {
                    expectedVersion: conversation.version,
                    forwarding:
                      conversation.forwarding === "deny" ? "selected" : "deny",
                  },
                  "PATCH",
                )
              }
            />
          )}{" "}
          {conversation.kind === "dm" && (
            <>
              <Button
                title="Block direct messages and calls"
                onPress={() =>
                  void act(`/companies/${w.company}/communication/blocks`, {
                    userId: members.find((m) => m.userId !== w.session?.user.id)
                      ?.userId,
                    blocked: true,
                  })
                }
              />
              <Button
                title="Unblock direct messages and calls"
                onPress={() =>
                  void act(`/companies/${w.company}/communication/blocks`, {
                    userId: members.find((m) => m.userId !== w.session?.user.id)
                      ?.userId,
                    blocked: false,
                  })
                }
              />
            </>
          )}
        </>
      )}
      <Button title="Close controls" onPress={onClose} />
    </View>
  );
}

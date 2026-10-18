import { useEffect, useEffectEvent, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Page, useWorkspace } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import {
  ScreenHeading,
  Surface,
  RecordCard,
  EmptyState,
  mobileUI,
} from "./MobileUI";
import { useExecutionRead, useExecutionMutation } from "./execution";
import { useRamInput } from "./ramInput";
import PersonPicker from "./PersonPicker";
import { ReportField } from "./ReportControls";
import ReviewedFileExport from "./ReviewedFileExport";
import {
  knowledgeDraft,
  knowledgeSubmission,
  knowledgeMarkdown,
} from "../../shared/knowledge/drafts";
import type {
  KnowledgeArticle,
  KnowledgeFields,
  KnowledgeDetail,
  KnowledgeList,
  KnowledgeAnswer,
  KnowledgeAnswerInput,
  KnowledgeMutationResult,
} from "../../shared/knowledge/types";
const pilots = ["engineering", "office", "field", "all"] as const;
export default function KnowledgeScreen() {
  const w = useWorkspace();
  return (
    <Home
      key={[
        w.company,
        w.session?.user.id,
        w.policyEpoch,
        w.work?.readBasis,
      ].join(":")}
    />
  );
}
function Home() {
  const w = useWorkspace(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [creating, setCreating] = useState(false),
    [sources, setSources] = useState<string[]>([]),
    [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<KnowledgeAnswerInput>();
  const q = useExecutionRead<KnowledgeList>(
    "/knowledge?" + new URLSearchParams({ query }),
  );
  const reload = useEffectEvent(() => q.retry());
  useEffect(() => {
    const timer = setInterval(() => reload(), 15000);
    return () => clearInterval(timer);
  }, []);
  const rows = q.ready ? (q.data?.articles ?? []) : [];
  return (
    <Page scroll={false} safeBottom>
      {selected ? (
        <Detail
          id={selected}
          onBack={() => {
            setSelected("");
            q.retry();
          }}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={
            <View>
              <ScreenHeading
                title="Knowledge"
                description="Reviewed guidance for engineering, office and field work."
                action={
                  !!w.work && w.work.me.role !== "viewer" ? (
                    <Action
                      title="New guidance"
                      primary
                      onPress={() => setCreating(true)}
                    />
                  ) : undefined
                }
              />
              <TextInput
                accessibilityLabel="Search guidance"
                value={search}
                onChangeText={setSearch}
                placeholder="Search current authorized guidance"
                style={ui.input}
              />
              <Action
                title="Search guidance"
                onPress={() => {
                  setQuery(search);
                  setAnswer(undefined);
                  setSources([]);
                }}
              />
              <Surface>
                <Text style={ui.body}>
                  Only current published guidance is used for answers. Select up
                  to eight sources. Answers quote matching passages with
                  citations; they do not make decisions or run actions.
                </Text>
                <Text style={mobileUI.filterLabel}>Guidance question</Text>
                <TextInput
                  accessibilityLabel="Guidance question"
                  maxLength={1000}
                  value={question}
                  onChangeText={(s) => {
                    setQuestion(s);
                    setAnswer(undefined);
                  }}
                  style={ui.input}
                />
                <Action
                  title="Find cited guidance"
                  disabled={!q.ready || !sources.length || !question.trim()}
                  onPress={() =>
                    setAnswer({ articleIds: [...sources], question })
                  }
                />
              </Surface>
              {answer && q.ready && (
                <Answer key={JSON.stringify(answer)} input={answer} />
              )}
              {!!q.error && <Text accessibilityRole="alert">{q.error}</Text>}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title={
                q.ready
                  ? "No guidance matches this view"
                  : "Checking current guidance…"
              }
              description="Create an owned draft or change your search. An independent reviewer publishes guidance."
            />
          }
          renderItem={({ item: a }) => (
            <Surface>
              <RecordCard
                title={a.title}
                label={"Open guidance: " + a.title}
                status={a.state}
                detail={
                  a.pilot +
                  " · v" +
                  a.version +
                  " · Review due " +
                  a.reviewDueDate
                }
                onPress={() => {
                  setAnswer(undefined);
                  setSelected(a.id);
                }}
              />
              {a.state === "published" && (
                <Action
                  title={
                    (sources.includes(a.id)
                      ? "✓ Selected source: "
                      : "Select source: ") + a.title
                  }
                  selected={sources.includes(a.id)}
                  disabled={!sources.includes(a.id) && sources.length >= 8}
                  onPress={() => {
                    setAnswer(undefined);
                    setSources((s) =>
                      s.includes(a.id)
                        ? s.filter((id) => id !== a.id)
                        : [...s, a.id],
                    );
                  }}
                />
              )}
            </Surface>
          )}
        />
      )}
      {creating && (
        <Editor
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSelected(id);
            q.retry();
          }}
        />
      )}
    </Page>
  );
}
function Answer({ input }: { input: KnowledgeAnswerInput }) {
  const q = useExecutionRead<KnowledgeAnswer>(
    "/knowledge/answers",
    true,
    input,
  );
  return (
    <Surface>
      <Text style={mobileUI.sectionTitle}>Selected-source passages</Text>
      {!q.ready ? (
        <Text>{q.error || "Checking current selected sources…"}</Text>
      ) : (
        <>
          <Text style={ui.body}>
            {q.data?.abstained ? q.data.reason : q.data?.answer}
          </Text>
          {q.data?.citations.map((c, i) => (
            <Text key={c.id} style={ui.subtitle}>
              [{i + 1}] {c.title} · version {c.version}
            </Text>
          ))}
        </>
      )}
    </Surface>
  );
}
function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useExecutionRead<KnowledgeDetail>("/knowledge/" + id),
    [edit, setEdit] = useState(false),
    [review, setReview] = useState(false),
    [exporting, setExporting] = useState(false);
  const reload = useEffectEvent(() => q.retry());
  useEffect(() => {
    const timer = setInterval(() => reload(), 15000);
    return () => clearInterval(timer);
  }, []);
  const d = q.ready ? q.data : undefined;
  return (
    <View style={{ flex: 1 }}>
      <Action title="‹ Knowledge" onPress={onBack} />
      {!d ? (
        <Text>{q.error || "Checking current guidance access…"}</Text>
      ) : (
        <FlatList
          data={d.reviews}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={
            <View>
              <ScreenHeading
                title={d.article.title}
                description={
                  d.article.pilot +
                  " · " +
                  d.article.state +
                  " · version " +
                  d.article.version
                }
              />
              <Surface>
                <Text style={ui.body}>{d.article.body}</Text>
                <Text style={ui.subtitle}>
                  Review due {d.article.reviewDueDate} in company time.
                  Audience:{" "}
                  {d.article.audience === "company"
                    ? "active company members"
                    : "selected readers, owner and reviewer"}
                  .
                </Text>
              </Surface>
              <Action
                title="Export guidance document"
                onPress={() => setExporting(true)}
              />
              {d.canEdit && (
                <Action
                  title="Edit guidance draft"
                  onPress={() => setEdit(true)}
                />
              )}
              {d.canReview && (
                <Action
                  title="Review guidance publication"
                  onPress={() => setReview(true)}
                />
              )}
              <Text style={mobileUI.sectionTitle}>Review history</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={ui.subtitle}>No visible review entries.</Text>
          }
          renderItem={({ item: r }) => (
            <Surface>
              <Text style={ui.name}>
                {r.decision} · version {r.articleVersion}
              </Text>
              <Text style={ui.body}>{r.reason}</Text>
            </Surface>
          )}
        />
      )}
      {exporting && d && (
        <ReviewedFileExport<KnowledgeDetail>
          title="Guidance document export"
          path={"/knowledge/" + id}
          fileName="workspace-guidance.md"
          description="Export this guidance title, body, version, publication state and review date."
          signature={(v) => v.article.id + ":" + v.article.version}
          summarize={(v) => [
            v.article.title,
            "Version " + v.article.version + " · " + v.article.state,
            "Publication audience: " + v.article.audience,
          ]}
          serialize={(v) => knowledgeMarkdown(v.article)}
          options={{
            mimeType: "text/markdown",
            UTI: "public.plain-text",
            dialogTitle: "Share reviewed guidance",
          }}
          onClose={() => setExporting(false)}
        />
      )}
      {edit && d?.canEdit && (
        <Editor
          article={d.article}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            q.retry();
          }}
        />
      )}
      {review && d?.canReview && (
        <Review
          article={d.article}
          onClose={() => setReview(false)}
          onSaved={() => {
            setReview(false);
            q.retry();
          }}
        />
      )}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  disabled,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  disabled: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text style={ui.name}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline={multiline}
        style={ui.input}
      />
    </View>
  );
}
function Editor({
  article: initialArticle,
  onClose,
  onSaved,
}: {
  article?: KnowledgeArticle;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const w = useWorkspace(),
    form = "$knowledge:" + (initialArticle?.id ?? "new") + ":edit",
    [authored, setAuthored, retireAuthored] = useRamInput<{
      source: KnowledgeArticle | undefined;
      fields: KnowledgeFields;
    }>(form, "boundDraft", () => ({
      source: initialArticle,
      fields: knowledgeDraft(initialArticle),
    }));
  const { source: article, fields: draft } = authored;
  const setDraft = (update: (fields: KnowledgeFields) => KnowledgeFields) =>
    setAuthored((d) => ({ ...d, fields: update(d.fields) }));

  const action = useExecutionMutation(
      form,
      article ? ["/knowledge/" + article.id] : [],
    ),
    shown = knowledgeSubmission(draft, action.attempt),
    locked = action.busy || !!action.attempt,
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const set = (k: keyof KnowledgeFields, v: unknown) => {
    setConfirmed(false);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  async function save() {
    if (!confirmed && !action.attempt) return;
    try {
      setAuthored(authored);
      const r = await action.execute<KnowledgeMutationResult>(
        "/knowledge" + (article ? "/" + article.id : ""),
        action.attempt?.payload ?? {
          ...draft,
          ...(article ? { expectedVersion: article.version } : {}),
        },
        article ? "PATCH" : "POST",
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const people = w.work?.people ?? [];
  return (
    <Sheet
      title={article ? "Edit guidance draft" : "New guidance"}
      onClose={onClose}
      busy={action.busy}
    >
      <Field
        label="Guidance title"
        value={shown.title}
        onChange={(s) => set("title", s)}
        disabled={locked}
      />
      <Field
        label="Guidance body"
        value={shown.body}
        onChange={(s) => set("body", s)}
        disabled={locked}
        multiline
      />
      <Text style={ui.name}>Pilot audience</Text>
      <View style={ui.row}>
        {pilots.map((p) => (
          <Action
            key={p}
            title={p}
            selected={shown.pilot === p}
            disabled={locked}
            onPress={() => set("pilot", p)}
          />
        ))}
      </View>
      <PersonPicker
        label="Independent guidance reviewer"
        people={people}
        excludeIds={[w.session?.user.id ?? ""]}
        value={shown.reviewerId}
        onChange={(s) => set("reviewerId", s)}
        disabled={locked}
      />
      <ReportField
        label="Guidance review due YYYY-MM-DD"
        value={shown.reviewDueDate}
        onChange={(s) => set("reviewDueDate", s)}
        calendar="date"
        timezone={w.work?.company.timezone ?? "UTC"}
        disabled={locked}
      />
      <Action
        title="Company publication audience"
        selected={shown.audience === "company"}
        disabled={locked}
        onPress={() => {
          set("audience", "company");
          set("readerIds", []);
        }}
      />
      <Action
        title="Selected publication audience"
        selected={shown.audience === "selected"}
        disabled={locked}
        onPress={() => set("audience", "selected")}
      />
      {shown.audience === "selected" && (
        <View>
          <PersonPicker
            includeViewers
            label="Add guidance reader"
            people={people}
            value=""
            excludeIds={[
              w.session?.user.id ?? "",
              shown.reviewerId,
              ...shown.readerIds,
            ]}
            onChange={(id) => {
              if (id && shown.readerIds.length < 100)
                set("readerIds", [...shown.readerIds, id]);
            }}
            disabled={locked || shown.readerIds.length >= 100}
          />
          {shown.readerIds.map((id) => (
            <Action
              key={id}
              title={
                "Remove reader: " +
                (people.find((p) => p.id === id)?.name ?? id)
              }
              disabled={locked}
              onPress={() =>
                set(
                  "readerIds",
                  shown.readerIds.filter((v) => v !== id),
                )
              }
            />
          ))}
        </View>
      )}
      {article && (
        <Action
          title={
            shown.state === "archived" ? "Restore draft" : "Archive guidance"
          }
          disabled={locked}
          onPress={() =>
            set("state", shown.state === "archived" ? "draft" : "archived")
          }
        />
      )}
      <Surface>
        <Text style={ui.name}>
          Publication audience:{" "}
          {shown.audience === "company"
            ? "All active members of " +
              (w.session?.companies?.find((c) => c.id === w.company)?.name ??
                w.company)
            : shown.readerIds
                .map((id) => people.find((p) => p.id === id)?.name ?? id)
                .join(", ") || "Owner and reviewer only"}
        </Text>
        <Text style={ui.body}>
          Drafts are visible only to you and the assigned reviewer. The reviewer
          publishes this text to the selected audience. Do not copy private
          conversation content without its explicit publication workflow.
        </Text>
      </Surface>
      {!action.attempt && (
        <Action
          title={
            confirmed
              ? "✓ Guidance audience reviewed"
              : "I reviewed this guidance and publication audience"
          }
          selected={confirmed}
          disabled={action.busy}
          onPress={() => setConfirmed((v) => !v)}
        />
      )}
      {!!(error || action.error) && (
        <Text accessibilityRole="alert">{error || action.error}</Text>
      )}
      <Action
        title={
          action.attempt
            ? "Retry original guidance submission"
            : "Save guidance draft"
        }
        primary
        disabled={
          action.busy ||
          (!action.attempt &&
            (!confirmed ||
              !shown.title.trim() ||
              !shown.body.trim() ||
              !shown.reviewerId ||
              !/^\d{4}-\d{2}-\d{2}$/.test(shown.reviewDueDate)))
        }
        onPress={() => void save()}
      />
      {!!action.attempt && (
        <Action
          title="Discard guidance attempt and review latest"
          disabled={action.busy}
          onPress={() => {
            action.abandon();
            retireAuthored(authored);
            setConfirmed(false);
          }}
        />
      )}
    </Sheet>
  );
}
function Review({
  article: initialArticle,
  onClose,
  onSaved,
}: {
  article: KnowledgeArticle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = "$knowledge:" + initialArticle.id + ":review";
  const action = useExecutionMutation(form, [
    "/knowledge/" + initialArticle.id,
  ]);
  const [authored, setAuthored, retireAuthored] = useRamInput(
    form,
    "boundDraft",
    () => ({
      source: initialArticle,
      fields: { decision: "return", reason: "" },
    }),
  );
  const { source: article, fields: draft } = authored;
  const setDraft = (update: (fields: typeof draft) => typeof draft) =>
    setAuthored((d) => ({ ...d, fields: update(d.fields) }));
  const shown = (action.attempt?.payload as typeof draft | undefined) ?? draft,
    locked = action.busy || !!action.attempt;
  const [confirmed, setConfirmed] = useState(false);
  async function save() {
    if (!confirmed && !action.attempt) return;
    try {
      setAuthored(authored);
      await action.execute(
        "/knowledge/" + article.id + "/review",
        action.attempt?.payload ?? {
          ...draft,
          expectedVersion: article.version,
        },
        "POST",
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved();
    } catch {}
  }
  return (
    <Sheet
      title="Review guidance publication"
      onClose={onClose}
      busy={action.busy}
    >
      <Text style={ui.body}>
        {article.title} · reviewed version{" "}
        {(action.attempt?.payload.expectedVersion as number) ?? article.version}
      </Text>
      <Text style={ui.subtitle}>
        Publishing shares exactly this guidance with{" "}
        {article.audience === "company"
          ? "all active company members"
          : article.readerIds.length +
            " selected readers: " +
            article.readerIds.join(", ")}
        , its owner and reviewer.
      </Text>
      <Text style={ui.body}>{article.body}</Text>
      <Action
        title="Return for revision"
        selected={shown.decision === "return"}
        disabled={locked}
        onPress={() => {
          setConfirmed(false);
          setDraft((d) => ({ ...d, decision: "return" }));
        }}
      />
      <Action
        title="Publish reviewed guidance"
        selected={shown.decision === "publish"}
        disabled={locked}
        onPress={() => {
          setConfirmed(false);
          setDraft((d) => ({ ...d, decision: "publish" }));
        }}
      />
      <Field
        label="Guidance review reason"
        value={shown.reason}
        disabled={locked}
        onChange={(reason) => {
          setConfirmed(false);
          setDraft((d) => ({ ...d, reason }));
        }}
        multiline
      />
      {!action.attempt && (
        <Action
          title={
            confirmed
              ? "✓ Review decision confirmed"
              : "I reviewed this decision and publication audience"
          }
          selected={confirmed}
          onPress={() => setConfirmed((v) => !v)}
        />
      )}
      {!!action.error && <Text accessibilityRole="alert">{action.error}</Text>}
      <Action
        title={
          action.attempt
            ? "Retry original publication decision"
            : "Record guidance review"
        }
        primary
        disabled={
          action.busy || (!confirmed && !action.attempt) || !shown.reason.trim()
        }
        onPress={() => void save()}
      />
      {!!action.attempt && (
        <Action
          title="Discard publication attempt and review latest"
          disabled={action.busy}
          onPress={() => {
            action.abandon();
            retireAuthored(authored);
            setConfirmed(false);
          }}
        />
      )}
    </Sheet>
  );
}

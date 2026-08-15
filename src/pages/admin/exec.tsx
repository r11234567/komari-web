import { useState, useRef, useEffect, useLayoutEffect, useMemo, type CSSProperties, type KeyboardEvent } from "react";
import Loading from "@/components/loading";
import { NodeDetailsProvider, useNodeDetails } from "@/contexts/NodeDetailsContext";
import { useTranslation } from "react-i18next";
import {
    Button,
    Card,
    Flex,
    Text,
    Separator,
    Badge,
    TextField
} from "@radix-ui/themes";
import { Play, AlertCircle, CheckCircle2, Copy, Clock, Square } from "lucide-react";
import { toast } from "sonner";
import NodeSelector from "@/components/NodeSelector";
import { SettingCardCollapse } from "@/components/admin/SettingCard";
import { RescueConsole } from "@/components/admin/RescueConsole";
import { cancelRemoteExecution, createRemoteExecutions, listRemoteAgentCapabilities, watchRemoteExecution } from "@/api/connect/remote";
import { OperationState } from "@komari/proto/komari/common/v1/common_pb";

interface TaskResult {
    task_id: string;
    client: string;
    client_info?: {
        uuid: string;
        name: string;
        [key: string]: any;
    };
    result: string;
    exit_code: number | null;
    finished_at: string | null;
    created_at: string;
    state?: OperationState;
}

const COMMAND_EDITOR_ID = "remote-exec-command-editor";
const COMMAND_EDITOR_COLLAPSED_LINES = 3;
const COMMAND_EDITOR_LINE_HEIGHT_VAR = "--command-editor-line-height";
const COMMAND_EDITOR_VERTICAL_PADDING_VAR = "--command-editor-vertical-padding";
const COMMAND_EDITOR_COLLAPSED_HEIGHT = `calc(${COMMAND_EDITOR_COLLAPSED_LINES} * var(${COMMAND_EDITOR_LINE_HEIGHT_VAR}) + var(${COMMAND_EDITOR_VERTICAL_PADDING_VAR}))`;
const COMMAND_EDITOR_LINE_NUMBER_LIMIT = 500;

const parsePixelValue = (value: string) => {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
};

const getCommandEditorBorderHeight = (element: HTMLElement | null) => {
    if (!element) {
        return 0;
    }

    const style = window.getComputedStyle(element);
    return parsePixelValue(style.borderTopWidth) + parsePixelValue(style.borderBottomWidth);
};

const getCommandEditorCollapsedHeight = (textarea: HTMLTextAreaElement, editor: HTMLElement | null) => {
    const style = window.getComputedStyle(textarea);
    const lineHeight = parsePixelValue(style.lineHeight);
    const verticalPadding = parsePixelValue(style.paddingTop) + parsePixelValue(style.paddingBottom);

    return COMMAND_EDITOR_COLLAPSED_LINES * lineHeight + verticalPadding + getCommandEditorBorderHeight(editor);
};

const ExecPage = () => {
    return (
        <NodeDetailsProvider>
            <ExecContent />
        </NodeDetailsProvider>
    );
};

const ExecContent = () => {
    const { t } = useTranslation();
    const { nodeDetail, isLoading, error } = useNodeDetails();
    const [command, setCommand] = useState("");
    const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
    const [executing, setExecuting] = useState(false);
    const [results, setResults] = useState<TaskResult[]>([]);
    const [taskId, setTaskId] = useState<string | null>(null);
    const [commandFocused, setCommandFocused] = useState(false);
    const [commandEditorHeight, setCommandEditorHeight] = useState(COMMAND_EDITOR_COLLAPSED_HEIGHT);
    const [twoFaEnabled, setTwoFaEnabled] = useState(false);
    const [twoFaCode, setTwoFaCode] = useState("");
    const [executionCapableNodes, setExecutionCapableNodes] = useState<Set<string>>(new Set());
    const [capabilitiesResolved, setCapabilitiesResolved] = useState(false);

    const executionControllersRef = useRef(new Map<string, AbortController>());
    const commandTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const commandEditorRef = useRef<HTMLDivElement | null>(null);
    const commandLineGutterRef = useRef<HTMLDivElement | null>(null);

    const commandLineCount = useMemo(() => {
        return command === "" ? 1 : command.split("\n").length;
    }, [command]);

    const commandLineLabels = useMemo(() => {
        if (commandFocused) {
            const renderedLineCount = Math.min(commandLineCount, COMMAND_EDITOR_LINE_NUMBER_LIMIT);
            const labels = Array.from({ length: renderedLineCount }, (_, index) => String(index + 1));

            if (commandLineCount > renderedLineCount) {
                labels.push(`+${commandLineCount - renderedLineCount}`);
            }

            return labels;
        }

        if (commandLineCount <= COMMAND_EDITOR_COLLAPSED_LINES) {
            return Array.from({ length: commandLineCount }, (_, index) => String(index + 1));
        }

        const visibleNumberedLines = COMMAND_EDITOR_COLLAPSED_LINES - 1;
        const remainingLines = commandLineCount - visibleNumberedLines;
        return [
            ...Array.from({ length: visibleNumberedLines }, (_, index) => String(index + 1)),
            `+${remainingLines}`,
        ];
    }, [commandFocused, commandLineCount]);

    const commandEditorStyle = useMemo<CSSProperties>(() => ({
        [COMMAND_EDITOR_LINE_HEIGHT_VAR]: "1.5rem",
        [COMMAND_EDITOR_VERTICAL_PADDING_VAR]: "1.5rem",
        height: commandEditorHeight,
        maxHeight: commandFocused ? "60vh" : COMMAND_EDITOR_COLLAPSED_HEIGHT,
    }), [commandEditorHeight, commandFocused]);

    useEffect(() => {
        return () => {
            for (const controller of executionControllersRef.current.values()) {
                controller.abort();
            }
            executionControllersRef.current.clear();
        };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void listRemoteAgentCapabilities(controller.signal)
            .then((agents) => {
                const supported = new Set(
                    agents
                        .filter((agent) => agent.capabilities?.execution?.available === true)
                        .map((agent) => agent.agentId),
                );
                setExecutionCapableNodes(supported);
                setSelectedNodes((current) => current.filter((agentId) => supported.has(agentId)));
                setCapabilitiesResolved(true);
            })
            .catch((error) => {
                if (!controller.signal.aborted) {
                    toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                }
            });
        return () => controller.abort();
    }, [t]);

    useEffect(() => {
        fetch("/api/me")
            .then((response) => response.json())
            .then((data) => {
                setTwoFaEnabled(Boolean(data?.["2fa_enabled"]));
            })
            .catch(() => {
                setTwoFaEnabled(false);
            });
    }, []);

    useLayoutEffect(() => {
        const textarea = commandTextareaRef.current;
        if (!textarea) {
            return;
        }

        if (!commandFocused) {
            textarea.scrollTop = 0;
            if (commandLineGutterRef.current) {
                commandLineGutterRef.current.scrollTop = 0;
            }
            setCommandEditorHeight(COMMAND_EDITOR_COLLAPSED_HEIGHT);
            return;
        }

        textarea.style.height = "0px";

        const measuredHeight = textarea.scrollHeight + getCommandEditorBorderHeight(commandEditorRef.current);
        const collapsedHeight = getCommandEditorCollapsedHeight(textarea, commandEditorRef.current);

        setCommandEditorHeight(`${Math.max(collapsedHeight, measuredHeight)}px`);
        textarea.style.height = "100%";
    }, [command, commandFocused]);

    if (isLoading) {
        return <Loading />;
    }

    if (error) {
        return <div className="text-red-500">{error}</div>;
    }

    const executeCommand = async () => {
		if (!twoFaEnabled) {
			toast.error(t("exec.errors.twoFactorRequired", "请先配置双重验证"));
			return;
		}
        if (!command.trim()) {
            toast.error(t("exec.errors.emptyCommand"));
            return;
        }

        if (selectedNodes.length === 0) {
            toast.error(t("exec.errors.noNodes"));
            return;
        }

        if (twoFaEnabled && !twoFaCode.trim()) {
            toast.error(t("account.otp_empty_error"));
            return;
        }

        for (const controller of executionControllersRef.current.values()) {
            controller.abort();
        }
        executionControllersRef.current.clear();

        setExecuting(true);
        setResults([]);
        setTaskId(null);

        try {
            const createController = new AbortController();
            const executions = await createRemoteExecutions({
                agentIds: selectedNodes,
                command,
                twoFactorCode,
                idempotencyKey: crypto.randomUUID(),
                signal: createController.signal,
            });
            if (executions.length === 0) {
                throw new Error(t("common.unknownError"));
            }
            setTaskId(executions[0].executionId);
            setTwoFaCode("");
            setResults(executions.map((execution) => ({
                task_id: execution.executionId,
                client: execution.agentId,
                client_info: { uuid: execution.agentId, name: nodeDetail.find((node) => node.uuid === execution.agentId)?.name ?? execution.agentId },
                result: "",
                exit_code: execution.exitCode ?? null,
                finished_at: execution.finishedAt ? execution.finishedAt.toString() : null,
                created_at: execution.createdAt?.toString() ?? new Date().toISOString(),
                state: execution.state,
            })));
            for (const execution of executions) {
                const controller = new AbortController();
                executionControllersRef.current.set(execution.executionId, controller);
                void (async () => {
                    let output = "";
                    try {
                        for await (const update of watchRemoteExecution({ executionId: execution.executionId, signal: controller.signal })) {
                            const event = update.event;
                            if (!event) continue;
                            if (event.output.byteLength > 0) output += new TextDecoder().decode(event.output, { stream: true });
                            setResults((current) => current.map((result) => result.task_id === execution.executionId ? {
                                ...result,
                                result: output,
                                state: event.state,
                                exit_code: event.exitCode ?? result.exit_code,
                                finished_at: [OperationState.CANCELLED, OperationState.DEADLINE_EXCEEDED, OperationState.FAILED, OperationState.SUCCEEDED].includes(event.state) ? new Date().toISOString() : result.finished_at,
                            } : result));
                        }
                    } catch (error) {
                        if (!controller.signal.aborted) {
                            toast.error(error instanceof Error ? error.message : t("common.unknownError"));
                        }
                    } finally {
                        executionControllersRef.current.delete(execution.executionId);
                    }
                })();
            }
            toast.success(t("exec.taskStarted"));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : t("common.unknownError");
            toast.error(errorMessage);
        } finally {
            setExecuting(false);
        }
    };

    const handleCommandKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
            return;
        }

        event.preventDefault();
        if (!executing) {
            executeCommand();
        }
    };

    const copyOutput = (output: string) => {
        navigator.clipboard.writeText(output);
        toast.success(t("common.success"));
    };

    const getSelectedNodeNames = () => {
        return selectedNodes.map(uuid => {
            const node = nodeDetail.find(n => n.uuid === uuid);
            return node ? node.name : uuid;
        }).join(", ");
    };

    const displayResultText = (result: TaskResult) => result.result;

    const getTaskStatus = (result: TaskResult) => {
        if (result.state === OperationState.DEADLINE_EXCEEDED) {
            return { status: "timeout", color: "orange" as const, text: t("exec.status.timeout", "超时") };
        }
        if (result.state === OperationState.CANCEL_REQUESTED) {
            return { status: "running", color: "orange" as const, text: t("exec.status.cancelRequested", "正在取消") };
        }
        if (result.state === OperationState.QUEUED || result.state === OperationState.RUNNING || result.finished_at === null) {
            return { status: "running", color: "blue" as const, text: t("exec.status.running") };
        }
        if (result.state === OperationState.SUCCEEDED || result.exit_code === 0) {
            return { status: "success", color: "green" as const, text: t("common.success") };
        }
        return { status: "failed", color: "red" as const, text: t("common.error") };
    };

    const cancelExecution = async (result: TaskResult) => {
        if (twoFaEnabled && !twoFaCode.trim()) {
            toast.error(t("account.otp_empty_error"));
            return;
        }
        const controller = new AbortController();
        try {
            const response = await cancelRemoteExecution({
                executionId: result.task_id,
                reason: "cancelled by administrator",
                twoFactorCode: twoFaCode,
                signal: controller.signal,
            });
            setTwoFaCode("");
            if (response.execution) {
                setResults((current) => current.map((item) => item.task_id === result.task_id ? { ...item, state: response.execution?.state } : item));
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t("common.unknownError"));
        }
    };

    return (
        <div className="km-page-admin-exec km-exec-header p-4 flex flex-col gap-3">
            {/* 页面标题 */}
            <div>
                <h1 className="text-2xl font-bold">{t("exec.title")}</h1>
                <Text size="2" color="gray" className="mt-1">
                    {t("exec.description")}
                </Text>
            </div>

            <Separator size="4" />

            <RescueConsole agentId={selectedNodes.length === 1 ? selectedNodes[0] : undefined} />

            {/* 命令输入区域 */}
            <Card className="km-exec-editor-card p-6">
                <Flex direction="column" gap="4">

                    <label htmlFor={COMMAND_EDITOR_ID} className="text-xl font-bold">
                        {t("exec.command")}
                    </label>
                    <div
                        ref={commandEditorRef}
                        className="grid grid-cols-[3.75rem_minmax(0,1fr)] overflow-hidden rounded-md border border-[var(--gray-a7)] bg-[var(--color-surface)] transition-[height,border-color,box-shadow] duration-200 focus-within:border-[var(--accent-8)] focus-within:shadow-[0_0_0_1px_var(--accent-8)]"
                        style={commandEditorStyle}
                    >
                        <div
                            ref={commandLineGutterRef}
                            aria-hidden="true"
                            className="km-exec-editor-gutter select-none overflow-hidden border-r border-[var(--gray-a5)] bg-[var(--gray-2)] px-2 text-right font-mono text-xs text-[var(--gray-11)] [line-height:var(--command-editor-line-height)] [padding-bottom:calc(var(--command-editor-vertical-padding)/2)] [padding-top:calc(var(--command-editor-vertical-padding)/2)]"
                        >
                            {commandLineLabels.map((label, index) => (
                                <div
                                    key={`${label}-${index}`}
                                    className={label.startsWith("+") ? "font-medium text-[var(--accent-11)]" : undefined}
                                >
                                    {label}
                                </div>
                            ))}
                        </div>
                        <textarea
                            id={COMMAND_EDITOR_ID}
                            ref={commandTextareaRef}
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            onFocus={() => setCommandFocused(true)}
                            onBlur={() => setCommandFocused(false)}
                            onKeyDown={handleCommandKeyDown}
                            onScroll={(event) => {
                                if (commandLineGutterRef.current) {
                                    commandLineGutterRef.current.scrollTop = event.currentTarget.scrollTop;
                                }
                            }}
                            placeholder={t("exec.commandPlaceholder")}
                            rows={COMMAND_EDITOR_COLLAPSED_LINES}
                            wrap="soft"
                            spellCheck={false}
                            className="km-exec-editor-input h-full w-full resize-none border-0 bg-transparent px-3 font-mono text-sm text-[var(--gray-12)] outline-none placeholder:text-[var(--gray-9)] [line-height:var(--command-editor-line-height)] [padding-bottom:calc(var(--command-editor-vertical-padding)/2)] [padding-top:calc(var(--command-editor-vertical-padding)/2)]"
                            style={{
                                maxHeight: commandFocused ? "60vh" : COMMAND_EDITOR_COLLAPSED_HEIGHT,
                                overflowY: commandFocused ? "auto" : "hidden",
                                overflowWrap: "break-word",
                                whiteSpace: "pre-wrap",
                            }}
                        />
                    </div>


                    <div>
                        <SettingCardCollapse title={t("exec.selectNodes")} defaultOpen>
                <NodeSelector
                                value={selectedNodes}
                    onChange={setSelectedNodes}
                    includeNode={capabilitiesResolved ? (node) => executionCapableNodes.has(node.uuid) : undefined}
                                className="min-h-[200px]"
                            />
                        </SettingCardCollapse>
                        {selectedNodes.length > 0 && (
                            <Text size="2" color="gray" className="mt-2">
                                {t("exec.selectedNodes", "已选择节点")}: {getSelectedNodeNames()}
                            </Text>
                        )}
                    </div>

                    <Flex justify="end" gap="2">
                        {twoFaEnabled ? (
                            <TextField.Root
                                className="w-32"
                                type="number"
                                placeholder="2FA"
                                value={twoFaCode}
                                onChange={(e) => setTwoFaCode((e.target as HTMLInputElement).value)}
                            />
                        ) : null}
                        <Button
                            onClick={executeCommand}
                            disabled={executing || !twoFaEnabled || !command.trim() || selectedNodes.length === 0 || !twoFaCode.trim()}
                        >
                            {executing ? (
                                <>
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                                    {t("exec.executing")}
                                </>
                            ) : (
                                <>
                                    <Play size={16} />
                                    {t("exec.execute")}
                                </>
                            )}
                        </Button>
                    </Flex>
                </Flex>
            </Card>

            {/* 执行结果区域 */}
            {results.length > 0 && (
                <Card className="km-exec-output p-6">
                    <Flex direction="column" gap="4">
                        <Flex justify="between" align="center">
                            <Text size="4" weight="medium">
                                {t("exec.results", "执行结果")}
                            </Text>
                            {taskId && (
                                <Text size="2" color="gray">
                                    Task ID: {taskId}
                                </Text>
                            )}
                        </Flex>

                        <div className="space-y-4">
                            {results.map((result) => {
                                const status = getTaskStatus(result);
                                return (
                                    <Card key={result.client} className="p-4">
                                        <Flex direction="column" gap="3">
                                            {/* 节点信息和状态 */}
                                            <label className="text-xl font-medium">
                                                {nodeDetail.find(n => n.uuid === result.client)?.name || result.client}
                                            </label>
                                            <Flex justify="between" align="center">
                                                <Flex align="center" gap="2">
                                                    <Text weight="medium">{result.client_info?.name ?? result.client}</Text>
                                                    <Badge
                                                        color={status.color}
                                                        variant="soft"
                                                    >
                                                        {status.status === "running" ? (
                                                            <>
                                                                <div className="animate-spin rounded-full h-3 w-3 border-2 border-current border-t-transparent" />
                                                                {status.text}
                                                            </>
                                                        ) : status.status === "success" ? (
                                                            <>
                                                                <CheckCircle2 size={12} />
                                                                {status.text}
                                                            </>
                                                        ) : status.status === "timeout" ? (
                                                            <>
                                                                <Clock size={12} />
                                                                {status.text}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <AlertCircle size={12} />
                                                                {status.text}
                                                            </>
                                                        )}
                                                    </Badge>
                                                    {result.exit_code !== null && (
                                                        <Text size="1" color="gray">
                                                            Exit Code: {result.exit_code}
                                                        </Text>
                                                    )}
                                                </Flex>

                                                <Flex gap="2">
                                                {result.finished_at === null && (
                                                    <Button
                                                        variant="soft"
                                                        color="red"
                                                        size="1"
                                                        onClick={() => cancelExecution(result)}
                                                        title={t("common.cancel")}
                                                        aria-label={t("common.cancel")}
                                                    >
                                                        <Square size={14} />
                                                    </Button>
                                                )}
                                                {result.result && (
                                                    <Button
                                                        variant="ghost"
                                                        size="1"
                                                        onClick={() => copyOutput(displayResultText(result))}
                                                        title={t("common.copy", "Copy")}
                                                        aria-label={t("common.copy", "Copy")}
                                                    >
                                                        <Copy size={14} />
                                                    </Button>
                                                )}
                                                </Flex>
                                            </Flex>

                                            {/* 时间信息 */}
                                            {/* <Flex gap="4" className="text-sm text-gray-500">
                                                <Text size="1" color="gray">
                                                    创建时间: {new Date(result.created_at).toLocaleString()}
                                                </Text>
                                                {result.finished_at && (
                                                    <Text size="1" color="gray">
                                                        完成时间: {new Date(result.finished_at).toLocaleString()}
                                                    </Text>
                                                )}
                                            </Flex> */}

                                            {/* 输出内容 */}
                                            {result.result && (
                                                <div className="bg-[var(--gray-2)] rounded-md p-3 font-mono text-sm overflow-x-auto">
                                                    <pre className="whitespace-pre-wrap">{displayResultText(result)}</pre>
                                                </div>
                                            )}
                                        </Flex>
                                    </Card>
                                );
                            })}
                        </div>
                    </Flex>
                </Card>
            )}
        </div>
    );
};

export default ExecPage;

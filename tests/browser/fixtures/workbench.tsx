import {useState} from "react";
import {createRoot} from "react-dom/client";
import {Theme} from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "../../../src/global.css";
import "../../../src/pages/terminal/Terminal.css";
import "@xterm/xterm/css/xterm.css";
import i18n from "i18next";
import {initReactI18next} from "react-i18next";
import en from "../../../src/i18n/locales/en.json";
import zh from "../../../src/i18n/locales/zh_CN.json";
import TerminalTabBar from "../../../src/pages/terminal/TerminalTabBar";
import TerminalSession from "../../../src/pages/terminal/TerminalSession";
import WorkspaceBoundary from "../../../src/pages/terminal/WorkspaceBoundary";
import {installFixtureGrant,workspaceState} from "./workspace";
import {state} from "./state";
const params=new URLSearchParams(location.search);
const locale=params.get("lang")==="en"?"en":"zh";
await i18n.use(initReactI18next).init({lng:locale,fallbackLng:locale,initImmediate:false,resources:{en:{translation:en},zh:{translation:zh}}});
const clients=[{uuid:"synthetic-agent",name:"Synthetic Debian",os:"debian"},{uuid:"second-agent",name:"Second Debian",os:"debian"}];
if(params.get("locked")!=="1")installFixtureGrant("synthetic-agent");
function Fixture(){
 const [tabs,setTabs]=useState(clients.map((c,i)=>({id:String(i),uuid:c.uuid,title:c.name,color:null as string|null})));
 const [server,setServer]=useState(false),[workbench,setWorkbench]=useState(false);
 return <Theme appearance="light"><WorkspaceBoundary appearance="dark"><Theme appearance="dark" className="km-page-terminal fixed inset-0 overflow-hidden">
 <div className="km-terminal-shell flex h-full w-full min-h-0 flex-col overflow-hidden">
 <TerminalTabBar tabs={tabs} clients={clients} clientsLoading={false} activeTabId="0" editingTabId={null} renameDraft="" serverMenuOpen={server} onServerMenuOpenChange={setServer} workbenchMenuOpen={workbench} onWorkbenchMenuOpenChange={setWorkbench}
 onActivate={()=>{}} onOpenTerminalClient={()=>setServer(false)} onOpenWorkbenchClient={()=>setWorkbench(false)} onStartRename={()=>{}} onDraftChange={()=>{}} onCommitRename={()=>{}} onCancelRename={()=>{}} onDuplicate={()=>{}} onExportText={()=>{}} onFind={()=>{}} onOpenFileManager={()=>{}} onOpenEditor={()=>{}} resourceMonitorServers={[]} onToggleResourceWindow={()=>{}} onColor={(id,color)=>setTabs(t=>t.map(tab=>tab.id===id?{...tab,color}:tab))} onClose={(id,mode)=>setTabs(t=>mode==="current"?t.filter(tab=>tab.id!==id):mode==="others"?t.filter(tab=>tab.id===id):t)} onReorder={()=>{}}/>
 <div className="min-h-0 flex-1 overflow-hidden"><TerminalSession uuid="synthetic-agent" active options={{fontSize:16}} padding={20} twoFaEnabled={false} disconnectMessage="Session closed" onApiChange={api=>{state.api=api}}/></div>
 </div></Theme></WorkspaceBoundary></Theme>
}
Object.assign(window,{workbenchAudit:{workspaceState}});
createRoot(document.getElementById("root")!).render(<Fixture/>);

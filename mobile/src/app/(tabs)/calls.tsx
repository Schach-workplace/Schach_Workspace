import {Text} from 'react-native';import Calls from '../../Calls';import {Page,useWorkspace} from '../../Workspace';
export default function CallScreen(){const w=useWorkspace();return <Page>{w.selected?<Calls/>:<Text>Choose an authorized conversation in Chats first.</Text>}</Page>}

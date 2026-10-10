import {Stack} from 'expo-router';
import {registerGlobals} from '@livekit/react-native';
import {WorkspaceProvider} from '../Workspace';
import {ActiveCall} from '../Calls';
registerGlobals();
export default function Layout(){return <WorkspaceProvider><Stack screenOptions={{headerShown:false}}/><ActiveCall/></WorkspaceProvider>}

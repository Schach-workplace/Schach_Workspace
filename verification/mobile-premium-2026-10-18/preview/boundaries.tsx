// Native capability / unrelated modal boundaries. They are not acceptance evidence.
import { Text } from "react-native";
export default function Boundary() {
  return <Text>Fictional preview: secondary native workflow</Text>;
}
export const NativeTemplates = Boundary;
export const NativeProjectChoice = Boundary;

export const NativeDeadline = Boundary;
export const NativeSchedule = Boundary;
export const NativeImpact = Boundary;
export const ExecutionField = Boundary;
export const ExecutionStatus = () => null;
export const ExecutionAttempt = () => null;
export const shareDocument = async () => {
  throw Error("Native file sharing is not available in layout preview.");
};

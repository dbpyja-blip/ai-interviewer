type ChatMessageProps = {
  message: string;
  accentColor: string;
  name: string;
  isSelf: boolean;
  hideName?: boolean;
};

export const ChatMessage = ({
  name,
  message,
  accentColor,
  isSelf,
  hideName,
}: ChatMessageProps) => {
  return (
    <div className={`flex flex-col gap-1 ${hideName ? "pt-0" : "pt-6"}`}>
      {!hideName && (
        <div
          className={`${
            isSelf 
              ? "text-gray-600 dark:text-gray-400" 
              : `text-${accentColor}-700 dark:text-${accentColor}-400`
          } uppercase text-xs`}
        >
          {name}
        </div>
      )}
      <div
        className={`pr-4 ${
          isSelf 
            ? "text-gray-900 dark:text-gray-200" 
            : `text-${accentColor}-600 dark:text-${accentColor}-400`
        } text-sm ${
          isSelf ? "" : "drop-shadow-" + accentColor
        } whitespace-pre-line`}
      >
        {message}
      </div>
    </div>
  );
};

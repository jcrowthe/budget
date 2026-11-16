import { Tooltip } from "../account/Tooltip";

const Key = ({ k }: { k: string }) => <kbd className="acct-tip-key">{k}</kbd>;
/** The shortcut tooltip of a bar button: the description, then its key caps. */
export function Tip({
  text,
  keys,
  then,
  children,
}: {
  text: string;
  keys: string[];
  then?: string;
  children: Parameters<typeof Tooltip>[0]["children"];
}) {
  return (
    <Tooltip
      placement="above"
      align="center"
      delayed={false}
      content={
        <span className="acct-tip-shortcut">
          <span>{text}</span>
          <span className="acct-tip-keys">
            {keys.map((k) => (
              <Key key={k} k={k} />
            ))}
            {then ? (
              <>
                <kbd className="acct-tip-key is-then">then</kbd>
                <Key k={then} />
              </>
            ) : null}
          </span>
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

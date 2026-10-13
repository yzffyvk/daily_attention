import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryEditor } from "@/features/checkins/summary-editor";

afterEach(cleanup);

function SummaryEditorHarness() {
  const [value, setValue] = useState("");

  return (
    <SummaryEditor
      disabled={false}
      id="summary"
      onChange={setValue}
      placeholder="记录知识点"
      value={value}
    />
  );
}

describe("SummaryEditor", () => {
  it("adjusts the writing font and size without changing stored text", async () => {
    const user = userEvent.setup();
    render(<SummaryEditorHarness />);

    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "注意力机制");
    await user.selectOptions(screen.getByLabelText("知识小结字体"), "serif");
    await user.selectOptions(screen.getByLabelText("知识小结字号"), "large");

    expect(textarea).toHaveValue("注意力机制");
    expect(textarea).toHaveClass("summary-font-serif");
    expect(textarea).toHaveClass("summary-size-large");
  });

  it("adds ordered prefixes to the selected lines", async () => {
    const user = userEvent.setup();
    render(<SummaryEditorHarness />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await user.type(textarea, "理解 Query\n理解 Key\n理解 Value");
    textarea.setSelectionRange(0, textarea.value.length);

    await user.click(screen.getByRole("button", { name: "添加前置序号" }));

    expect(textarea).toHaveValue(
      "1. 理解 Query\n2. 理解 Key\n3. 理解 Value",
    );
  });
});

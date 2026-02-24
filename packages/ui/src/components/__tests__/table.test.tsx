import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "../table";

describe("Table", () => {
  describe("Table component", () => {
    it("renders table element", () => {
      render(<Table data-testid="table" />);
      expect(screen.getByTestId("table")).toBeInTheDocument();
    });

    it("renders as table element", () => {
      render(<Table data-testid="table" />);
      expect(screen.getByTestId("table").tagName).toBe("TABLE");
    });

    it("applies base styling", () => {
      render(<Table data-testid="table" />);
      const table = screen.getByTestId("table");
      expect(table).toHaveClass("w-full");
      expect(table).toHaveClass("caption-bottom");
      expect(table).toHaveClass("text-sm");
    });
  });

  describe("TableHeader component", () => {
    it("renders thead element", () => {
      render(
        <Table>
          <TableHeader data-testid="header" />
        </Table>
      );
      expect(screen.getByTestId("header").tagName).toBe("THEAD");
    });

    it("applies border-b styling", () => {
      render(
        <Table>
          <TableHeader data-testid="header" />
        </Table>
      );
      expect(screen.getByTestId("header")).toHaveClass("[&_tr]:border-b");
    });
  });

  describe("TableBody component", () => {
    it("renders tbody element", () => {
      render(
        <Table>
          <TableBody data-testid="body" />
        </Table>
      );
      expect(screen.getByTestId("body").tagName).toBe("TBODY");
    });

    it("applies last row border styling", () => {
      render(
        <Table>
          <TableBody data-testid="body" />
        </Table>
      );
      expect(screen.getByTestId("body")).toHaveClass("[&_tr:last-child]:border-0");
    });
  });

  describe("TableFooter component", () => {
    it("renders tfoot element", () => {
      render(
        <Table>
          <TableFooter data-testid="footer" />
        </Table>
      );
      expect(screen.getByTestId("footer").tagName).toBe("TFOOT");
    });

    it("applies border-t styling", () => {
      render(
        <Table>
          <TableFooter data-testid="footer" />
        </Table>
      );
      expect(screen.getByTestId("footer")).toHaveClass("border-t");
    });

    it("applies muted background", () => {
      render(
        <Table>
          <TableFooter data-testid="footer" />
        </Table>
      );
      expect(screen.getByTestId("footer")).toHaveClass("bg-muted/50");
    });
  });

  describe("TableRow component", () => {
    it("renders tr element", () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row" />
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("row").tagName).toBe("TR");
    });

    it("applies border-b styling", () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row" />
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("row")).toHaveClass("border-b");
    });

    it("applies hover styling", () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row" />
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("row")).toHaveClass("hover:bg-muted/50");
    });

    it("applies data-state selected styling", () => {
      render(
        <Table>
          <TableBody>
            <TableRow data-testid="row" />
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("row")).toHaveClass("data-[state=selected]:bg-muted");
    });
  });

  describe("TableHead component", () => {
    it("renders th element", () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="head">Header</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      );
      expect(screen.getByTestId("head").tagName).toBe("TH");
    });

    it("applies text styling", () => {
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead data-testid="head">Header</TableHead>
            </TableRow>
          </TableHeader>
        </Table>
      );
      const head = screen.getByTestId("head");
      expect(head).toHaveClass("text-left");
      expect(head).toHaveClass("font-medium");
    });
  });

  describe("TableCell component", () => {
    it("renders td element", () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="cell">Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("cell").tagName).toBe("TD");
    });

    it("applies padding styling", () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell data-testid="cell">Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("cell")).toHaveClass("p-4");
    });
  });

  describe("TableCaption component", () => {
    it("renders caption element", () => {
      render(
        <Table>
          <TableCaption data-testid="caption">Caption</TableCaption>
        </Table>
      );
      expect(screen.getByTestId("caption").tagName).toBe("CAPTION");
    });

    it("applies muted foreground text", () => {
      render(
        <Table>
          <TableCaption data-testid="caption">Caption</TableCaption>
        </Table>
      );
      expect(screen.getByTestId("caption")).toHaveClass("text-muted-foreground");
    });
  });

  describe("composition", () => {
    it("renders complete table", () => {
      render(
        <Table>
          <TableCaption>A list of users</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>John Doe</TableCell>
              <TableCell>john@example.com</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total: 1 user</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      );

      expect(screen.getByText("A list of users")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("John Doe")).toBeInTheDocument();
      expect(screen.getByText("john@example.com")).toBeInTheDocument();
      expect(screen.getByText("Total: 1 user")).toBeInTheDocument();
    });
  });

  describe("custom className", () => {
    it("applies custom className to Table", () => {
      render(<Table className="custom-class" data-testid="table" />);
      expect(screen.getByTestId("table")).toHaveClass("custom-class");
    });

    it("applies custom className to TableRow", () => {
      render(
        <Table>
          <TableBody>
            <TableRow className="custom-class" data-testid="row" />
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("row")).toHaveClass("custom-class");
    });

    it("applies custom className to TableCell", () => {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="custom-class" data-testid="cell">Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
      expect(screen.getByTestId("cell")).toHaveClass("custom-class");
    });
  });
});

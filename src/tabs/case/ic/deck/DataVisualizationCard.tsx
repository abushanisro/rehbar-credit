import React from "react";
import { AnnexuresCard } from "./AnnexuresCard";

interface DataVisualizationCardProps {
  clientName: string;
}

export function DataVisualizationCard({ clientName }: DataVisualizationCardProps) {
  return (
    <AnnexuresCard
      clientName={clientName}
      subtitle="Data Visualization Sourced from Accumn"
    />
  );
}

import SwiftUI

struct PaywallView: View {
    @State private var selectedPlan = "yearly"
    var onSubscribe: (String) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    Text("Go Pro")
                        .font(.custom("Inter", size: 34))
                        .bold()
                    Text("Unlimited projects, sync and themes.")
                        .foregroundStyle(.secondary)
                    PlanRow(title: "Yearly", price: "$39.99", selected: selectedPlan == "yearly")
                        .onTapGesture { selectedPlan = "yearly" }
                    PlanRow(title: "Monthly", price: "$4.99", selected: selectedPlan == "monthly")
                        .onTapGesture { selectedPlan = "monthly" }
                    Button("Subscribe") { onSubscribe(selectedPlan) }
                        .buttonStyle(.borderedProminent)
                        .padding(16)
                }
                .padding(16)
            }
            .navigationTitle("Upgrade")
        }
    }
}
